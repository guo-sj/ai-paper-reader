import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export interface CachedPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  link: string;
  category: string;
  upvotes?: number;
}

interface PapersCacheFileShape {
  version: 1;
  dateKey: string;
  papers: CachedPaper[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFilePath = path.resolve(__dirname, 'papers-cache.json');

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
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, json, 'utf8');

  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore
  }
  await fs.rename(tmpPath, filePath);
}

export async function readPapersCache(): Promise<{ dateKey: string; papers: CachedPaper[] } | null> {
  if (!(await fileExists(cacheFilePath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    if (!raw.trim()) return null;

    const parsed = JSON.parse(raw) as Partial<PapersCacheFileShape>;
    if (!parsed.dateKey || !Array.isArray(parsed.papers)) return null;

    return { dateKey: parsed.dateKey, papers: parsed.papers };
  } catch {
    return null;
  }
}

export async function writePapersCache(dateKey: string, papers: CachedPaper[]): Promise<void> {
  const data: PapersCacheFileShape = {
    version: 1,
    dateKey,
    papers,
  };
  await atomicWriteJson(cacheFilePath, data);
  console.log(`[PapersCache] Written ${papers.length} papers for ${dateKey}`);
}
