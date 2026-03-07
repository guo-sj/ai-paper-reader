type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEnvelope<T> {
  updatedAt: number;
  value: T;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readJsonCache<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  return safeParse<T>(localStorage.getItem(key));
}

export function writeJsonCache<T extends JsonValue>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`cacheStore: failed to write ${key}`, e);
  }
}

export function removeJsonCache(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function readJsonCacheWithTtl<T>(
  key: string,
  maxAgeMs: number
): { value: T | null; isStale: boolean } {
  const envelope = readJsonCache<CacheEnvelope<T>>(key);
  if (!envelope || typeof envelope.updatedAt !== 'number') {
    return { value: null, isStale: true };
  }
  const isStale = Date.now() - envelope.updatedAt > maxAgeMs;
  return { value: isStale ? null : envelope.value, isStale };
}

export function writeJsonCacheWithTimestamp<T extends JsonValue>(key: string, value: T): void {
  const envelope: CacheEnvelope<T> = {
    updatedAt: Date.now(),
    value,
  };
  writeJsonCache(key, envelope as JsonValue);
}
