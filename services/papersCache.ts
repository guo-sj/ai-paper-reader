import { PaperWithAnalysis } from '../types';
import { readJsonCacheWithTtl, writeJsonCacheWithTimestamp, removeJsonCache, DEFAULT_CACHE_TTL_MS } from './cacheStore';

export const CACHE_VERSION = 'v2';
const CACHE_STORAGE_KEY = `ai-insight:cache:papers:${CACHE_VERSION}`;

interface PapersCache {
  papers: PaperWithAnalysis[];
}

export function getCachedPapers(
  maxAgeMs: number = DEFAULT_CACHE_TTL_MS
): { papers: PaperWithAnalysis[]; isStale: boolean } {
  const { value, isStale } = readJsonCacheWithTtl<PapersCache>(CACHE_STORAGE_KEY, maxAgeMs);
  if (!value) return { papers: [], isStale: true };
  return { papers: value.papers, isStale };
}

export function setCachedPapers(papers: PaperWithAnalysis[]): void {
  // writeJsonCacheWithTimestamp requires JsonValue constraint; cast needed due to cacheStore's strict type
  writeJsonCacheWithTimestamp(CACHE_STORAGE_KEY, {
    papers: Array.isArray(papers) ? papers : [],
  } as unknown as Parameters<typeof writeJsonCacheWithTimestamp>[1]);
}

export function clearPapersCache(): void {
  removeJsonCache(CACHE_STORAGE_KEY);
}
