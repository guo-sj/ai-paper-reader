import fetch from 'node-fetch';
import { PaperAnalysis } from '../types.js';

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.gptplus5.com';
const MODEL = 'gpt-4o';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Paper {
    id: string;
    title: string;
    summary: string;
    category?: string;
}

interface CategoryDef {
    id: string;
    label: string;
    aliases: string[];
}

export function mapHFCategory(hfCategory: string, categories: CategoryDef[]): string {
    if (!hfCategory) return 'other';
    const lower = hfCategory.toLowerCase();
    for (const cat of categories) {
        if (cat.id === 'other') continue;
        const terms = [cat.label, ...cat.aliases];
        for (const term of terms) {
            if (lower.includes(term.toLowerCase())) {
                return cat.id;
            }
        }
    }
    return 'other';
}

function buildPrompt(batch: Paper[], categories: CategoryDef[]): string {
    const categoryList = categories.map(c => `${c.id}（${c.label}）`).join(', ');
    return `
请分析以下来自 arXiv 的最新 AI 研究论文。
请务必使用 **中文** 提供 JSON 格式的结构化分析。
必须返回一个 JSON 数组，每个元素包含字段：paperId（与下方 ID 一致）、summary、relevanceScore（1-10 的数字）、categories（字符串数组）、categoryScores（对象）。

分析重点包括：
1. 用 50~150 字的中文写一段综合摘要（summary），涵盖：该论文解决的核心问题、采用的关键方法和技术创新点，以及对 AI 领域的潜在影响，要求信息密度高，让专家一眼能看出论文讲了什么。
2. 针对普通 AI 研究者的相关度评分（relevanceScore，1-10分）。
3. 从以下预定义类别中，选出该论文最相关的 1-3 个类别，并给出每个类别的相关度评分（1-10）。
   可选类别 ID：[${categoryList}]
   每篇论文会附带 HF 平台的原始分类标签，可作为参考，但请以论文标题和摘要内容为主要判断依据。
   返回：categories（选中类别 ID 的字符串数组）、categoryScores（对象，key 为类别 ID，value 为 1-10 评分）。
   注意：categories 中的值必须来自上方可选类别 ID，不得自行创造新类别。

待分析论文：
${batch.map((p) => `
---
ID: ${p.id}
标题: ${p.title}
摘要: ${p.summary}
HF 分类参考: ${p.category || '无'}
`).join('\n')}

请直接返回 JSON 数组，不要其他说明。例如：
[{"paperId":"...","summary":"...","relevanceScore":8,"categories":["attention","llm"],"categoryScores":{"attention":9,"llm":6}}, ...]
`.trim();
}

async function analyzeBatch(apiKey: string, batch: Paper[], categories: CategoryDef[], batchIndex: number, totalBatches: number): Promise<Record<string, PaperAnalysis>> {
    console.log(`[OpenAI] Batch ${batchIndex}/${totalBatches}: sending ${batch.length} papers to ${OPENAI_BASE} (model: ${MODEL})`);
    batch.forEach(p => console.log(`  - ${p.id}: ${p.title.slice(0, 60)}... [hfCategory: ${p.category ?? 'N/A'}]`));

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
        console.error(`[OpenAI] Batch ${batchIndex}/${totalBatches}: request timed out after 120s`);
    }, 120_000);

    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: buildPrompt(batch, categories) }],
            max_tokens: 16384,
        }),
        signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
        console.error(`[OpenAI] Batch ${batchIndex}/${totalBatches}: HTTP ${res.status}`);
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

    console.log(`[OpenAI] Batch ${batchIndex}/${totalBatches}: response OK, parsing...`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string }, finish_reason?: string }> };
    const finishReason = data.choices?.[0]?.finish_reason;
    const rawContent = data.choices?.[0]?.message?.content?.trim() || '[]';
    const content = rawContent.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
    console.log(`[OpenAI] Batch ${batchIndex}/${totalBatches}: finish_reason=${finishReason}, content length=${content.length}, tail: ...${content.slice(-80)}`);

    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        console.error(`[OpenAI] Batch ${batchIndex}/${totalBatches}: invalid JSON response:`, content.slice(0, 200));
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
    console.log(`[OpenAI] Batch ${batchIndex}/${totalBatches}: parsed ${arr.length} analyses`);
    if (arr.length !== batch.length) {
        console.warn(`[OpenAI] Batch ${batchIndex}/${totalBatches}: expected ${batch.length} results, got ${arr.length}`);
    }

    const record: Record<string, PaperAnalysis> = {};
    for (const a of arr as Record<string, unknown>[]) {
        const paperId = a?.paperId as string | undefined;
        if (!paperId) continue;
        const llmCategories = Array.isArray(a.categories) ? a.categories.map(String).filter(id => categories.some(c => c.id === id)) : [];
        const llmCategoryScores = (a.categoryScores && typeof a.categoryScores === 'object' && !Array.isArray(a.categoryScores))
            ? Object.fromEntries(Object.entries(a.categoryScores as Record<string, unknown>).filter(([k]) => categories.some(c => c.id === k)).map(([k, v]) => [k, Number(v) || 0]))
            : {};
        // fallback to mapHFCategory if LLM returned no valid categories
        const paper = batch.find(p => p.id === paperId);
        const hfMapped = mapHFCategory(paper?.category ?? '', categories);
        const finalCategories = llmCategories.length > 0 ? llmCategories : [hfMapped];
        const finalCategoryScores = llmCategories.length > 0 ? llmCategoryScores : { [hfMapped]: 10 };
        record[paperId] = {
            paperId,
            summary: String(a.summary ?? ''),
            relevanceScore: Number(a.relevanceScore) || 0,
            categories: finalCategories,
            categoryScores: finalCategoryScores,
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
    categories: CategoryDef[] = []
): Promise<Record<string, PaperAnalysis>> {
    const batches = chunk(papers, BATCH_SIZE);
    const merged: Record<string, PaperAnalysis> = {};
    console.log(`[OpenAI] Starting analysis: ${papers.length} papers → ${batches.length} batch(es), BATCH_SIZE=${BATCH_SIZE}`);

    for (let i = 0; i < batches.length; i++) {
        try {
            const result = await analyzeBatch(apiKey, batches[i], categories, i + 1, batches.length);
            Object.assign(merged, result);
        } catch (error) {
            console.error(`[OpenAI] Batch ${i + 1}/${batches.length} failed:`, error);
            const status = (error as Error & { status?: number })?.status;
            // 认证或限流错误直接抛出，无需继续
            if (status === 401 || status === 429) throw error;
        }
        if (i < batches.length - 1) await delay(BATCH_DELAY_MS);
    }

    console.log(`[OpenAI] Analysis complete: ${Object.keys(merged).length}/${papers.length} papers analyzed`);
    return merged;
}
