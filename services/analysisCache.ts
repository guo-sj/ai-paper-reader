import { PaperAnalysis } from '../types';
import { readJsonCacheWithTtl, writeJsonCacheWithTimestamp, removeJsonCache, DEFAULT_CACHE_TTL_MS } from './cacheStore';

const CACHE_STORAGE_KEY = 'ai-insight:cache:analyses';
const CACHE_MAX_AGE_MS = DEFAULT_CACHE_TTL_MS;

type CacheByModel = Record<string, Record<string, PaperAnalysis>>;

function readCache(): CacheByModel {
  const { value } = readJsonCacheWithTtl<CacheByModel>(CACHE_STORAGE_KEY, CACHE_MAX_AGE_MS);
  return value && typeof value === 'object' ? value : {};
}

function writeCache(cache: CacheByModel): void {
  writeJsonCacheWithTimestamp(CACHE_STORAGE_KEY, cache);
}

/**
 * Returns cached analyses for the given model (keyed by paper id).
 */
export function getCachedAnalyses(modelId: string): Record<string, PaperAnalysis> {
  const cache = readCache();
  const byModel = cache[modelId];
  return byModel && typeof byModel === 'object' ? { ...byModel } : {};
}

/**
 * Merges new analyses into the cache for the given model and persists.
 */
export function mergeCachedAnalyses(
  modelId: string,
  newAnalyses: Record<string, PaperAnalysis>
): void {
  const cache = readCache();
  const existing = cache[modelId] ?? {};
  cache[modelId] = { ...existing, ...newAnalyses };
  writeCache(cache);
}

/**
 * Clears all cached analyses (optional; for user-initiated clear).
 */
export function clearAnalysisCache(): void {
  removeJsonCache(CACHE_STORAGE_KEY);
}
