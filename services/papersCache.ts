import { ArxivPaper } from '../types';
import { readJsonCacheWithTtl, writeJsonCacheWithTimestamp, removeJsonCache, DEFAULT_CACHE_TTL_MS } from './cacheStore';

const CACHE_STORAGE_KEY = 'ai-insight:cache:papers';

interface PapersCache {
  papers: ArxivPaper[];
}

export function getCachedPapers(
  limit: number,
  maxAgeMs: number = DEFAULT_CACHE_TTL_MS
): { papers: ArxivPaper[]; isStale: boolean } {
  const { value, isStale } = readJsonCacheWithTtl<PapersCache>(CACHE_STORAGE_KEY, maxAgeMs);
  if (!value) return { papers: [], isStale };
  return { papers: value.papers.slice(0, limit), isStale };
}

export function setCachedPapers(papers: ArxivPaper[]): void {
  writeJsonCacheWithTimestamp(CACHE_STORAGE_KEY, {
    papers: Array.isArray(papers) ? papers : [],
  });
}

export function clearPapersCache(): void {
  removeJsonCache(CACHE_STORAGE_KEY);
}
