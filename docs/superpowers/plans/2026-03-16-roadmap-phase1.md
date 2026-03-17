# Roadmap Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add category classification, multi-dimensional scoring, and frontend filtering/sorting so experts can quickly find the most relevant Top 5 papers in their domain (Attention, MoE, 量化, etc.).

**Architecture:** GPT-4o classifies every HF daily paper into 1-3 predefined categories and outputs per-category relevance scores alongside the existing analysis. The backend exposes these scores via updated `/api/papers` and new `/api/categories` endpoints. The frontend loads all papers once and performs all filtering and scoring locally, with a horizontal tab bar for category selection.

**Tech Stack:** TypeScript, Express, React, Tailwind CSS, OpenAI GPT-4o, localStorage (no new dependencies)

**Spec:** `docs/superpowers/specs/2026-03-16-roadmap-phase1-design.md`

> **No test framework is configured in this project.** Each task's verification step is a manual check using `npm run dev`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/categories.json` | Create | Category definitions + scoring weights |
| `types.ts` | Modify | Add `categories`, `categoryScores` to `PaperAnalysis` |
| `server/analyzedPapersCacheFile.ts` | Modify | Fix import: PaperAnalysis from `../types` |
| `server/analyzeService.ts` | Modify | Remove duplicate type; extend prompt; raise max_tokens; skip already-analyzed |
| `server/server.ts` | Modify | Add `/api/categories`; update `/api/papers` response; add `computeFinalScore`; skip-analyzed logic |
| `services/huggingFaceService.ts` | Modify | Adapt to `{ papers, totalCount }` response; add `fetchCategories()` |
| `services/papersCache.ts` | Modify | Store full paper+analysis objects; add CACHE_VERSION v2 check |
| `services/analysisCache.ts` | Modify | Keep but stop writing to it (reads tolerated for cache purge); App.tsx no longer calls it |
| `App.tsx` | Modify | Load categories+weights; inline-analysis paper model; frontend filter+sort; integrate CategoryFilter |
| `components/CategoryFilter.tsx` | Create | Horizontal scrolling tab bar with URL sync |
| `components/PaperCard.tsx` | Modify | Category badges; rank marker; Hidden Gem indicator |

---

## Task 1: Create `server/categories.json`

**Files:**
- Create: `server/categories.json`

- [ ] **Step 1: Create the file**

```json
{
  "version": 1,
  "scoring": {
    "w_upvotes": 0.3,
    "w_relevance": 0.3,
    "w_category": 0.4
  },
  "categories": [
    { "id": "attention",    "label": "Attention / Transformer", "aliases": ["self-attention", "transformer architecture", "sparse attention", "linear attention"] },
    { "id": "moe",          "label": "MoE (Mixture of Experts)", "aliases": ["mixture of experts", "sparse experts", "expert routing"] },
    { "id": "quantization", "label": "量化 (Quantization)",     "aliases": ["low-bit", "post-training quantization", "QAT", "int4", "int8", "quantization-aware training"] },
    { "id": "diffusion",    "label": "Diffusion Models",        "aliases": ["denoising diffusion", "score-based", "DDPM", "flow matching"] },
    { "id": "llm",          "label": "LLM",                     "aliases": ["large language model", "language model", "GPT", "instruction tuning"] },
    { "id": "multimodal",   "label": "Multimodal",              "aliases": ["vision-language", "multi-modal", "VLM", "image-text"] },
    { "id": "rl",           "label": "Reinforcement Learning",  "aliases": ["RLHF", "reward model", "PPO", "DPO", "policy gradient"] },
    { "id": "cv",           "label": "Computer Vision",         "aliases": ["image classification", "object detection", "segmentation", "CLIP"] },
    { "id": "nlp",          "label": "NLP",                     "aliases": ["text classification", "named entity", "sentiment", "summarization"] },
    { "id": "efficient",    "label": "Efficient AI",            "aliases": ["pruning", "distillation", "sparsity", "hardware efficient", "inference optimization"] },
    { "id": "agent",        "label": "AI Agent",                "aliases": ["tool use", "autonomous agent", "agentic", "planning"] },
    { "id": "rag",          "label": "RAG / Retrieval",         "aliases": ["retrieval augmented", "vector search", "dense retrieval"] },
    { "id": "safety",       "label": "AI Safety",               "aliases": ["alignment", "red teaming", "jailbreak", "hallucination"] },
    { "id": "video",        "label": "Video Generation",        "aliases": ["video synthesis", "video diffusion", "text-to-video"] },
    { "id": "3d",           "label": "3D / NeRF",               "aliases": ["neural radiance", "3D reconstruction", "gaussian splatting"] },
    { "id": "speech",       "label": "Speech / Audio",          "aliases": ["TTS", "ASR", "speech synthesis", "audio generation"] },
    { "id": "code",         "label": "Code Generation",         "aliases": ["code completion", "program synthesis", "coding LLM"] },
    { "id": "robotics",     "label": "Robotics",                "aliases": ["embodied AI", "manipulation", "robot learning"] },
    { "id": "other",        "label": "Other",                   "aliases": [] }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add server/categories.json
git commit -m "feat: add categories config with scoring weights"
```

---

## Task 2: Extend `types.ts` — add category fields to PaperAnalysis

**Files:**
- Modify: `types.ts:88-94`

Current `PaperAnalysis` (lines 88-94):
```typescript
export interface PaperAnalysis {
  paperId: string;
  geminiSummary: string;
  keyInnovation: string;
  potentialImpact: string;
  relevanceScore: number; // 1-10
}
```

- [ ] **Step 1: Add the two new fields**

Replace the interface with:
```typescript
export interface PaperAnalysis {
  paperId: string;
  geminiSummary: string;
  keyInnovation: string;
  potentialImpact: string;
  relevanceScore: number; // 1-10
  categories: string[];                    // e.g. ["attention", "llm"]
  categoryScores: Record<string, number>;  // e.g. {"attention": 9, "llm": 6}
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in `server/analyzeService.ts` (duplicate interface — fixed in Task 3). No other errors.

- [ ] **Step 3: Commit**

```bash
git add types.ts
git commit -m "feat: add categories and categoryScores fields to PaperAnalysis type"
```

---

## Task 3: Fix `server/analyzedPapersCacheFile.ts` import

**Files:**
- Modify: `server/analyzedPapersCacheFile.ts:5`

- [ ] **Step 1: Fix the import**

Change line 5 from:
```typescript
import { PaperAnalysis } from './analyzeService.js';
```
to:
```typescript
import { PaperAnalysis } from '../types.js';
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: same or fewer errors — no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add server/analyzedPapersCacheFile.ts
git commit -m "refactor: import PaperAnalysis from types.ts (single source of truth)"
```

---

## Task 4: Update `server/analyzeService.ts`

**Files:**
- Modify: `server/analyzeService.ts`

Changes: (1) remove duplicate `PaperAnalysis` interface, import from types; (2) extend `buildPrompt` with classification instruction + example output; (3) raise `max_tokens` to 8192; (4) parse `categories` and `categoryScores` in `analyzeBatch`.

- [ ] **Step 1: Replace the file content**

```typescript
import fetch from 'node-fetch';
import { PaperAnalysis } from '../types.js';

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.gptplus5.com';
const MODEL = 'gpt-4o';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Paper {
    id: string;
    title: string;
    summary: string;
}

function buildPrompt(batch: Paper[], categoryIds: string[]): string {
    const categoryList = categoryIds.join(', ');
    return `
请分析以下来自 arXiv 的最新 AI 研究论文。
请务必使用 **中文** 提供 JSON 格式的结构化分析。
必须返回一个 JSON 数组，每个元素包含字段：paperId（与下方 ID 一致）、geminiSummary、keyInnovation、potentialImpact、relevanceScore（1-10 的数字）、categories（字符串数组）、categoryScores（对象）。

分析重点包括：
1. 核心方法论的简洁摘要（geminiSummary）。
2. 与之前工作相比的关键创新点（keyInnovation）。
3. 对 AI 领域的长期潜在影响（potentialImpact）。
4. 针对普通 AI 研究者的相关度评分（relevanceScore，1-10分）。
5. 从以下预定义类别中，选出该论文最相关的 1-3 个类别，并给出每个类别的相关度评分（1-10）。
   可选类别 ID：[${categoryList}]
   返回：categories（选中类别 ID 的字符串数组）、categoryScores（对象，key 为类别 ID，value 为 1-10 评分）。
   不相关的类别不需要出现在 categoryScores 中。

待分析论文：
${batch.map((p) => `
---
ID: ${p.id}
标题: ${p.title}
摘要: ${p.summary}
`).join('\n')}

请直接返回 JSON 数组，不要其他说明。例如：
[{"paperId":"...","geminiSummary":"...","keyInnovation":"...","potentialImpact":"...","relevanceScore":8,"categories":["attention","llm"],"categoryScores":{"attention":9,"llm":6}}, ...]
`.trim();
}

async function analyzeBatch(apiKey: string, batch: Paper[], categoryIds: string[]): Promise<Record<string, PaperAnalysis>> {
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: buildPrompt(batch, categoryIds) }],
            response_format: { type: 'json_object' },
            max_tokens: 8192,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        let message = errText;
        try {
            const errJson = JSON.parse(errText) as { error?: { message?: string } };
            if (errJson?.error?.message) message = errJson.error.message;
        } catch {
            // keep errText
        }
        const err = new Error(
            res.status === 401
                ? `OpenAI API 密钥无效 (401)：${message}`
                : res.status === 429
                    ? `OpenAI 请求过于频繁 (429)：${message}`
                    : `OpenAI API ${res.status}: ${message}`
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() || '{}';

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error('OpenAI returned invalid JSON');
    }

    let arr: unknown[];
    if (Array.isArray(parsed)) {
        arr = parsed;
    } else if (parsed && typeof parsed === 'object') {
        const firstArray = Object.values(parsed as Record<string, unknown>).find(Array.isArray);
        arr = (firstArray as unknown[]) ?? [];
    } else {
        arr = [];
    }
    console.log(`[OpenAI] parsed ${arr.length} analyses`);

    const record: Record<string, PaperAnalysis> = {};
    for (const a of arr as Record<string, unknown>[]) {
        const paperId = a?.paperId as string | undefined;
        if (!paperId) continue;
        record[paperId] = {
            paperId,
            geminiSummary: String(a.geminiSummary ?? ''),
            keyInnovation: String(a.keyInnovation ?? ''),
            potentialImpact: String(a.potentialImpact ?? ''),
            relevanceScore: Number(a.relevanceScore) || 0,
            categories: Array.isArray(a.categories) ? (a.categories as string[]) : [],
            categoryScores: (a.categoryScores && typeof a.categoryScores === 'object' && !Array.isArray(a.categoryScores))
                ? Object.fromEntries(
                    Object.entries(a.categoryScores as Record<string, unknown>)
                        .map(([k, v]) => [k, Number(v) || 0])
                  )
                : {},
        };
    }
    return record;
}

function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export async function analyzeWithOpenAI(
    papers: Paper[],
    apiKey: string,
    categoryIds: string[] = []
): Promise<Record<string, PaperAnalysis>> {
    const batches = chunk(papers, BATCH_SIZE);
    const merged: Record<string, PaperAnalysis> = {};

    for (let i = 0; i < batches.length; i++) {
        try {
            const result = await analyzeBatch(apiKey, batches[i], categoryIds);
            Object.assign(merged, result);
        } catch (error) {
            console.error(`[OpenAI] Batch ${i + 1}/${batches.length} failed:`, error);
            const status = (error as Error & { status?: number })?.status;
            if (status === 401 || status === 429) throw error;
        }
        if (i < batches.length - 1) await delay(BATCH_DELAY_MS);
    }

    return merged;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors in `analyzeService.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/analyzeService.ts
git commit -m "feat: extend analyzeService with category classification and scores"
```

---

## Task 5: Update `server/server.ts`

**Files:**
- Modify: `server/server.ts`

Changes: (1) add helper to read `categories.json`; (2) update `fetchAndAnalyzePapers` — pass category IDs, implement skip-already-analyzed logic; (3) add `computeFinalScore`; (4) update `GET /api/papers` to return `{ papers, totalCount }`; (5) add `GET /api/categories`.

- [ ] **Step 1: Add `fs` import for reading categories (already imported) and add the categories helper**

After the existing imports block (around line 24), add:

```typescript
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// (these already exist — don't duplicate)
```

Add a new helper function after the `getYesterdayKey` function (around line 311):

```typescript
// --- Categories Config ---

interface CategoryDef {
    id: string;
    label: string;
    aliases: string[];
}

interface CategoriesConfig {
    version: number;
    scoring: { w_upvotes: number; w_relevance: number; w_category: number };
    categories: CategoryDef[];
}

async function readCategoriesConfig(): Promise<CategoriesConfig> {
    const filePath = path.resolve(__dirname, 'categories.json');
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw) as CategoriesConfig;
    } catch {
        // Fallback defaults if file missing
        return {
            version: 1,
            scoring: { w_upvotes: 0.3, w_relevance: 0.3, w_category: 0.4 },
            categories: [],
        };
    }
}
```

- [ ] **Step 2: Add `computeFinalScore` helper**

Add after `readCategoriesConfig`:

```typescript
function computeFinalScore(
    paper: AnalyzedPaper,
    category: string | undefined,
    allPapers: AnalyzedPaper[],
    weights: { w_upvotes: number; w_relevance: number; w_category: number }
): number {
    const maxUpvotes = Math.max(...allPapers.map(p => p.upvotes ?? 0), 1);
    // clamp prevents an outlier from compressing all others near 0
    const u = Math.min(paper.upvotes ?? 0, maxUpvotes) / maxUpvotes;
    const r = (paper.analysis?.relevanceScore ?? 0) / 10;
    const c = category
        ? (paper.analysis?.categoryScores?.[category] ?? 0) / 10
        : 0.5; // All view: neutral category dimension
    return weights.w_upvotes * u + weights.w_relevance * r + weights.w_category * c;
}
```

- [ ] **Step 3: Update `fetchAndAnalyzePapers` to skip already-analyzed papers**

Replace the existing `fetchAndAnalyzePapers` function (lines 396-418) with:

```typescript
const fetchAndAnalyzePapers = async (): Promise<void> => {
    const papers = await fetchAndCachePapers();
    if (papers.length === 0) {
        console.warn('[fetchAndAnalyzePapers] No papers fetched from HF, skipping analysis.');
        return;
    }
    const todayKey = getTodayKey();

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        throw new Error('论文分析服务未配置（缺少 OPENAI_API_KEY）');
    }

    // Read categories config for prompt injection
    const config = await readCategoriesConfig();
    const categoryIds = config.categories.map(c => c.id);

    // Load existing analyzed cache for today
    const existingCache = await readAnalyzedPapersCache();
    const isToday = existingCache?.dateKey === todayKey;
    const alreadyAnalyzedIds = new Set(
        isToday ? existingCache!.papers.map(p => p.id) : []
    );

    // Papers that haven't been analyzed yet
    const toAnalyze = papers.filter(p => !alreadyAnalyzedIds.has(p.id));

    // Build the merged result: start from existing (if today) or empty
    const existingById: Record<string, AnalyzedPaper> = {};
    if (isToday && existingCache) {
        for (const p of existingCache.papers) {
            existingById[p.id] = p;
        }
    }

    if (toAnalyze.length > 0) {
        console.log(`[fetchAndAnalyzePapers] Analyzing ${toAnalyze.length} new papers (${alreadyAnalyzedIds.size} already cached)...`);
        const analyses = await analyzeWithOpenAI(toAnalyze, apiKey, categoryIds);
        for (const p of toAnalyze) {
            existingById[p.id] = { ...p, analysis: analyses[p.id] };
        }
    } else {
        console.log('[fetchAndAnalyzePapers] All papers already analyzed, updating upvotes only.');
    }

    // Always refresh upvotes from latest fetch
    for (const p of papers) {
        if (existingById[p.id]) {
            existingById[p.id] = { ...existingById[p.id], upvotes: p.upvotes };
        }
    }

    // Write merged result preserving today's order (by upvotes descending)
    const merged = papers.map(p => existingById[p.id] ?? { ...p }).filter(Boolean);
    await writeAnalyzedPapersCache(todayKey, merged);
    console.log('[fetchAndAnalyzePapers] Analysis complete and saved to analyze_papers_result.json.');
};
```

- [ ] **Step 4: Update `GET /api/papers` — return `{ papers, totalCount }` and remove limit truncation**

Replace the existing `/api/papers` route handler (lines 656-679):

```typescript
app.get('/api/papers', async (req, res) => {
    const refresh = req.query.refresh === 'true';
    const todayKey = getTodayKey();

    try {
        const analyzed = await readAnalyzedPapersCache();
        const needsRefresh = refresh || !analyzed || analyzed.papers.length === 0 || analyzed.dateKey !== todayKey;

        if (needsRefresh) {
            console.log('[/api/papers] Fetching and analyzing papers...');
            await fetchAndAnalyzePapers();
        }

        const result = await readAnalyzedPapersCache();
        if (!result || result.papers.length === 0) {
            return res.status(503).json({ error: '暂无论文数据，请稍后重试' });
        }

        const config = await readCategoriesConfig();
        const papers = result.papers;

        // Sort by finalScore (All view: category dimension = 0.5)
        const sorted = [...papers].sort((a, b) =>
            computeFinalScore(b, undefined, papers, config.scoring) -
            computeFinalScore(a, undefined, papers, config.scoring)
        );

        return res.json({ papers: sorted, totalCount: sorted.length });
    } catch (error: any) {
        console.error('Error in /api/papers:', error);
        return res.status(503).json({ error: error.message || '论文获取或分析失败' });
    }
});
```

- [ ] **Step 5: Add `GET /api/categories` endpoint**

Add this route after the `/api/papers` route:

```typescript
app.get('/api/categories', async (_req, res) => {
    try {
        const config = await readCategoriesConfig();
        return res.json({
            scoring: config.scoring,
            categories: config.categories.map(c => ({ id: c.id, label: c.label })),
        });
    } catch (error) {
        console.error('Error reading categories:', error);
        return res.status(500).json({ error: 'Failed to load categories' });
    }
});
```

- [ ] **Step 6: Verify server starts without errors**

```bash
npm run server
```

Expected: `Server running on http://localhost:3001` — no TypeScript or runtime errors.

- [ ] **Step 7: Verify new API endpoints**

```bash
curl http://localhost:3001/api/categories
```

Expected: JSON with `scoring` and `categories` array.

```bash
curl "http://localhost:3001/api/papers" | head -c 200
```

Expected: JSON object starting with `{"papers":[` not `[{`.

- [ ] **Step 8: Commit**

```bash
git add server/server.ts
git commit -m "feat: add /api/categories, update /api/papers response format, add computeFinalScore"
```

---

## Task 6: Update frontend data layer

**Files:**
- Modify: `services/huggingFaceService.ts`
- Modify: `services/papersCache.ts`

### 6a: `huggingFaceService.ts`

Replace the entire file:

```typescript
import { ArxivPaper, PaperAnalysis } from '../types';

export interface PaperWithAnalysis extends ArxivPaper {
  analysis?: PaperAnalysis;
}

export interface CategoryInfo {
  id: string;
  label: string;
}

export interface CategoriesResponse {
  scoring: { w_upvotes: number; w_relevance: number; w_category: number };
  categories: CategoryInfo[];
}

export interface PapersResponse {
  papers: PaperWithAnalysis[];
  totalCount: number;
}

export const fetchLatestAIPapers = async (refresh: boolean = false): Promise<PapersResponse> => {
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', 'true');
  const response = await fetch(`/api/papers?${params}`);
  if (!response.ok) throw new Error('Failed to fetch from backend API');
  return (await response.json()) as PapersResponse;
};

export const fetchCategories = async (): Promise<CategoriesResponse> => {
  const response = await fetch('/api/categories');
  if (!response.ok) throw new Error('Failed to fetch categories');
  return (await response.json()) as CategoriesResponse;
};
```

- [ ] **Step 1: Write the updated file** (content above)

### 6b: `services/papersCache.ts`

Replace the entire file with a v2 cache that stores full papers with embedded analysis:

```typescript
import { PaperAnalysis, ArxivPaper } from '../types';
import { readJsonCacheWithTtl, writeJsonCacheWithTimestamp, removeJsonCache, DEFAULT_CACHE_TTL_MS } from './cacheStore';

export const CACHE_VERSION = 'v2';
const CACHE_STORAGE_KEY = `ai-insight:cache:papers:${CACHE_VERSION}`;

export interface PaperWithAnalysis extends ArxivPaper {
  analysis?: PaperAnalysis;
}

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
  writeJsonCacheWithTimestamp(CACHE_STORAGE_KEY, {
    papers: Array.isArray(papers) ? papers : [],
  });
}

export function clearPapersCache(): void {
  removeJsonCache(CACHE_STORAGE_KEY);
}
```

- [ ] **Step 2: Write the updated file** (content above)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in `App.tsx` (not yet updated) and `services/analysisCache.ts` (unused imports) — nothing new.

- [ ] **Step 4: Commit**

```bash
git add services/huggingFaceService.ts services/papersCache.ts
git commit -m "feat: update data layer — new papers response format, v2 cache with embedded analysis"
```

---

## Task 7: Create `components/CategoryFilter.tsx`

**Files:**
- Create: `components/CategoryFilter.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useRef } from 'react';

export interface CategoryInfo {
  id: string;
  label: string;
}

interface CategoryFilterProps {
  categories: CategoryInfo[];
  selected: string | null; // null = "All"
  onSelect: (categoryId: string | null) => void;
}

const CategoryFilter: React.FC<CategoryFilterProps> = ({ categories, selected, onSelect }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const allTabs: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'All' },
    ...categories.map(c => ({ id: c.id, label: c.label })),
  ];

  return (
    <div className="border-b border-slate-200 bg-white sticky top-[73px] z-40">
      <div
        ref={scrollRef}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto py-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {allTabs.map(tab => (
          <button
            key={tab.id ?? '__all__'}
            onClick={() => onSelect(tab.id)}
            className={`
              flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap
              ${selected === tab.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CategoryFilter;
```

- [ ] **Step 2: Commit**

```bash
git add components/CategoryFilter.tsx
git commit -m "feat: add CategoryFilter horizontal tab bar component"
```

---

## Task 8: Update `App.tsx`

**Files:**
- Modify: `App.tsx`

This is the most significant change. Replace the entire file:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { fetchLatestAIPapers, fetchCategories, PaperWithAnalysis, CategoryInfo } from './services/huggingFaceService';
import { getCachedPapers, setCachedPapers } from './services/papersCache';
import { DEFAULT_CACHE_TTL_MS } from './services/cacheStore';
import PaperCard from './components/PaperCard';
import CategoryFilter from './components/CategoryFilter';
import SubscriptionForm from './components/SubscriptionForm';

const PAPER_CACHE_MAX_AGE_MS = DEFAULT_CACHE_TTL_MS;
const TOP_N = 5;

interface ScoringWeights {
  w_upvotes: number;
  w_relevance: number;
  w_category: number;
}

function computeFinalScore(
  paper: PaperWithAnalysis,
  category: string | null,
  allPapers: PaperWithAnalysis[],
  weights: ScoringWeights
): number {
  const maxUpvotes = Math.max(...allPapers.map(p => p.upvotes ?? 0), 1);
  const u = Math.min(paper.upvotes ?? 0, maxUpvotes) / maxUpvotes;
  const r = (paper.analysis?.relevanceScore ?? 0) / 10;
  const c = category
    ? (paper.analysis?.categoryScores?.[category] ?? 0) / 10
    : 0.5;
  return weights.w_upvotes * u + weights.w_relevance * r + weights.w_category * c;
}

function isHiddenGem(paper: PaperWithAnalysis): boolean {
  if (!paper.analysis?.categoryScores) return false;
  const maxCatScore = Math.max(...Object.values(paper.analysis.categoryScores), 0);
  return maxCatScore >= 9 && (paper.upvotes ?? 0) < 20;
}

function getCategoryFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('category');
}

function setCategoryInUrl(categoryId: string | null): void {
  const params = new URLSearchParams(window.location.search);
  if (categoryId) {
    params.set('category', categoryId);
  } else {
    params.delete('category');
  }
  const newUrl = params.toString()
    ? `${window.location.pathname}?${params}`
    : window.location.pathname;
  window.history.pushState({}, '', newUrl);
}

const App: React.FC = () => {
  const [papers, setPapers] = useState<PaperWithAnalysis[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [scoring, setScoring] = useState<ScoringWeights>({ w_upvotes: 0.3, w_relevance: 0.3, w_category: 0.4 });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(getCategoryFromUrl);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load categories on mount
  useEffect(() => {
    fetchCategories()
      .then(({ categories: cats, scoring: sc }) => {
        setCategories(cats);
        setScoring(sc);
      })
      .catch(err => console.warn('Failed to load categories:', err));
  }, []);

  const loadData = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setLoadingPapers(true);
      setError(null);

      let papersToUse: PaperWithAnalysis[] = [];
      if (!forceRefresh) {
        const cached = getCachedPapers(PAPER_CACHE_MAX_AGE_MS);
        if (!cached.isStale && cached.papers.length > 0) {
          papersToUse = cached.papers;
        }
      }

      if (papersToUse.length === 0) {
        const { papers: fetched } = await fetchLatestAIPapers(forceRefresh);
        papersToUse = fetched;
        setCachedPapers(fetched);
      }

      setPapers(papersToUse);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoadingPapers(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Sync URL on category change
  const handleCategorySelect = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    setCategoryInUrl(categoryId);
  };

  // Browser back/forward support
  useEffect(() => {
    const onPopState = () => setSelectedCategory(getCategoryFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Compute displayed papers
  const displayedPapers = (() => {
    if (selectedCategory === null) {
      // All: sort by finalScore descending, show all
      return [...papers].sort((a, b) =>
        computeFinalScore(b, null, papers, scoring) -
        computeFinalScore(a, null, papers, scoring)
      );
    }
    // Category view: filter by category, sort by score, take Top N
    const filtered = papers.filter(p =>
      p.analysis?.categories?.includes(selectedCategory)
    );
    return filtered
      .sort((a, b) =>
        computeFinalScore(b, selectedCategory, papers, scoring) -
        computeFinalScore(a, selectedCategory, papers, scoring)
      )
      .slice(0, TOP_N);
  })();

  const selectedCategoryLabel = selectedCategory
    ? categories.find(c => c.id === selectedCategory)?.label ?? selectedCategory
    : null;

  const categoryPaperCount = selectedCategory
    ? papers.filter(p => p.analysis?.categories?.includes(selectedCategory)).length
    : papers.length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-200">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">AI Insight</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Curated Daily AI Papers</p>
            </div>
          </div>

          <SubscriptionForm />

          <div className="flex items-center gap-3">
            <button
              onClick={() => loadData(true)}
              disabled={loadingPapers}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {loadingPapers ? (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {loadingPapers ? '获取中...' : '刷新'}
            </button>
          </div>
        </div>
      </header>

      {/* Category Filter */}
      {!loadingPapers && categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
        />
      )}

      {/* Main Content */}
      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {error && (
          <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {loadingPapers ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-96 animate-pulse border border-slate-100 p-6 space-y-4">
                <div className="h-4 bg-slate-100 rounded w-1/4"></div>
                <div className="h-8 bg-slate-100 rounded w-3/4"></div>
                <div className="h-4 bg-slate-100 rounded w-1/2"></div>
                <div className="mt-8 space-y-2">
                  <div className="h-20 bg-blue-50/50 rounded"></div>
                  <div className="h-4 bg-slate-50 rounded"></div>
                  <div className="h-4 bg-slate-50 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">
                  {selectedCategoryLabel ? selectedCategoryLabel : 'Latest Discoveries'}
                </h2>
                {selectedCategory ? (
                  displayedPapers.length > 0 ? (
                    <p className="text-slate-500 mt-1">
                      Top {displayedPapers.length} / 共 {categoryPaperCount} 篇 · {selectedCategoryLabel}
                    </p>
                  ) : (
                    <p className="text-slate-500 mt-1">今日暂无「{selectedCategoryLabel}」的论文，试试其他类别？</p>
                  )
                ) : (
                  <p className="text-slate-500 mt-1">Found {papers.length} groundbreaking papers from today's releases.</p>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-full border border-green-100">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  Live Feed
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100">
                  GPT-4o Enhanced
                </div>
              </div>
            </div>

            {displayedPapers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayedPapers.map((paper, index) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    analysis={paper.analysis}
                    rank={selectedCategory && index < 3 ? index + 1 : undefined}
                    isHiddenGem={isHiddenGem(paper)}
                  />
                ))}
              </div>
            ) : !selectedCategory && (
              <div className="text-center py-20">
                <h3 className="text-lg font-bold text-slate-700">No papers found</h3>
                <p className="text-slate-500">Try refreshing the feed in a few minutes.</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-sm">
            Powered by <span className="text-slate-600 font-semibold">Hugging Face</span> & <span className="text-blue-600 font-semibold">OpenAI GPT-4o</span>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
```

- [ ] **Step 1: Write the file** (content above)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in `PaperCard.tsx` (new props not yet added). No other errors.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat: update App.tsx with category filtering, sorting, and URL sync"
```

---

## Task 9: Update `components/PaperCard.tsx`

**Files:**
- Modify: `components/PaperCard.tsx`

Add `rank` and `isHiddenGem` props, display category badges.

- [ ] **Step 1: Replace the file**

```tsx
import React, { useState } from 'react';
import { ArxivPaper, PaperAnalysis } from '../types';

interface PaperCardProps {
  paper: ArxivPaper & { analysis?: PaperAnalysis };
  analysis?: PaperAnalysis;
  isLoadingAnalysis?: boolean;
  rank?: number;        // 1, 2, or 3 — shows rank badge
  isHiddenGem?: boolean;
}

const RANK_COLORS: Record<number, string> = {
  1: 'bg-yellow-400 text-yellow-900',
  2: 'bg-slate-300 text-slate-800',
  3: 'bg-amber-600 text-white',
};

const PaperCard: React.FC<PaperCardProps> = ({ paper, analysis, isLoadingAnalysis = false, rank, isHiddenGem = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formattedDate = new Date(paper.published).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <div className="relative bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md hover:border-blue-200">
      {/* Rank badge */}
      {rank && (
        <div className={`absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black z-10 ${RANK_COLORS[rank] ?? 'bg-blue-100 text-blue-700'}`}>
          #{rank}
        </div>
      )}

      <div className={`p-5 ${rank ? 'pt-4' : ''}`}>
        <div className="flex justify-between items-start gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Category badges from AI analysis */}
            {analysis?.categories && analysis.categories.length > 0 ? (
              analysis.categories.map(cat => (
                <span key={cat} className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs font-semibold rounded uppercase tracking-wider">
                  {cat}
                </span>
              ))
            ) : (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs font-semibold rounded uppercase tracking-wider">
                {paper.category}
              </span>
            )}

            {/* Upvotes */}
            {paper.upvotes !== undefined && paper.upvotes > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 text-xs font-semibold rounded">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                </svg>
                {paper.upvotes}
              </span>
            )}

            {/* Hidden Gem badge */}
            {isHiddenGem && (
              <span
                title="AI 评分极高但热度较低的隐藏好论文"
                className="px-2 py-0.5 bg-purple-50 text-purple-600 text-xs font-semibold rounded cursor-help"
              >
                Hidden Gem
              </span>
            )}
          </div>
          <span className="text-slate-400 text-xs flex-shrink-0">{formattedDate}</span>
        </div>

        <h3 className={`${rank ? 'mt-2' : 'mt-3'} text-lg font-bold text-slate-900 leading-snug`}>
          <a href={paper.link} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
            {paper.title}
          </a>
        </h3>

        <p className="mt-2 text-sm text-slate-500 line-clamp-2">
          By {paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}
        </p>

        {isLoadingAnalysis ? (
          <div className="mt-6 space-y-3 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-3/4"></div>
            <div className="h-4 bg-slate-100 rounded w-full"></div>
            <div className="h-4 bg-slate-100 rounded w-5/6"></div>
          </div>
        ) : analysis ? (
          <div className="mt-6 space-y-4">
            <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <h4 className="text-xs font-bold text-blue-800 uppercase tracking-widest">AI Summary</h4>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed italic">
                "{analysis.geminiSummary}"
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Key Innovation</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{analysis.keyInnovation}</p>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Impact</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{analysis.potentialImpact}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">Relevance:</span>
                <span className={`text-xs font-bold ${analysis.relevanceScore >= 8 ? 'text-green-500' : 'text-slate-600'}`}>
                  {analysis.relevanceScore}/10
                </span>
              </div>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                {isExpanded ? 'Show Less' : 'View Abstract'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 py-4 text-center border-t border-slate-50">
            <p className="text-xs text-slate-400">Analysis currently unavailable</p>
          </div>
        )}

        {isExpanded && (
          <div className="mt-4 p-4 bg-slate-50 rounded text-xs text-slate-600 leading-relaxed">
            <h4 className="font-bold mb-1">Abstract</h4>
            {paper.summary}
          </div>
        )}
      </div>
    </div>
  );
};

export default PaperCard;
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/PaperCard.tsx
git commit -m "feat: update PaperCard with category badges, rank marker, Hidden Gem indicator"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Start the full dev stack**

```bash
npm run dev
```

Expected: frontend on `http://localhost:3000`, backend on `http://localhost:3001`.

- [ ] **Step 2: Verify `/api/categories` returns expected shape**

```bash
curl http://localhost:3001/api/categories | python3 -m json.tool | head -20
```

Expected: `scoring` object and array of 19 `{ id, label }` objects.

- [ ] **Step 3: Verify frontend loads**

Open `http://localhost:3000` in a browser.
Expected: page loads, shows paper cards, horizontal category tab bar appears below the header.

- [ ] **Step 4: Verify category filtering**

Click any category tab. Expected: list updates to show at most 5 papers, count text shows "Top N / 共 M 篇 · CategoryName".

- [ ] **Step 5: Verify empty category state**

Click a category unlikely to have papers today (e.g., "Robotics" on a slow day). Expected: "今日暂无「Robotics」的论文，试试其他类别？" message, no crash.

- [ ] **Step 6: Verify URL sync**

Click a category, copy URL, open in new tab. Expected: same category is pre-selected on load.

- [ ] **Step 7: Verify Hidden Gem badge**

If any paper has `categoryScores` max >= 9 AND upvotes < 20, it should show "Hidden Gem" badge. (May not appear on all days.)

- [ ] **Step 8: Final commit (if any cleanup)**

```bash
git add -A
git status  # review before committing
git commit -m "chore: phase 1 end-to-end verified"
```

---

## Summary of commits in this branch

1. `feat: add categories config with scoring weights`
2. `feat: add categories and categoryScores fields to PaperAnalysis type`
3. `refactor: import PaperAnalysis from types.ts (single source of truth)`
4. `feat: extend analyzeService with category classification and scores`
5. `feat: add /api/categories, update /api/papers response format, add computeFinalScore`
6. `feat: update data layer — new papers response format, v2 cache with embedded analysis`
7. `feat: add CategoryFilter horizontal tab bar component`
8. `feat: update App.tsx with category filtering, sorting, and URL sync`
9. `feat: update PaperCard with category badges, rank marker, Hidden Gem indicator`
10. `chore: phase 1 end-to-end verified`
