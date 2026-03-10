import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CachedPaper } from './papersCacheFile.js';
import { PaperAnalysis } from './analyzeService.js';

export interface AnalyzedPaper extends CachedPaper {
  analysis?: PaperAnalysis;
}

interface AnalyzedPapersCacheFileShape {
  version: 1;
  dateKey: string;
  papers: AnalyzedPaper[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFilePath = path.resolve(__dirname, 'analyze_papers_result.json');

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');

  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore
  }
  await fs.rename(tmpPath, filePath);
}

export async function readAnalyzedPapersCache(): Promise<{ dateKey: string; papers: AnalyzedPaper[] } | null> {
  if (!(await fileExists(cacheFilePath))) return null;

  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    if (!raw.trim()) return null;

    const parsed = JSON.parse(raw) as Partial<AnalyzedPapersCacheFileShape>;
    if (!parsed.dateKey || !Array.isArray(parsed.papers)) return null;

    return { dateKey: parsed.dateKey, papers: parsed.papers };
  } catch {
    return null;
  }
}

export async function writeAnalyzedPapersCache(dateKey: string, papers: AnalyzedPaper[]): Promise<void> {
  const data: AnalyzedPapersCacheFileShape = {
    version: 1,
    dateKey,
    papers,
  };
  await atomicWriteJson(cacheFilePath, data);
  console.log(`[AnalyzedPapersCache] Written ${papers.length} analyzed papers for ${dateKey}`);
}
