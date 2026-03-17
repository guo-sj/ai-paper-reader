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
            // 认证或限流错误直接抛出，无需继续
            if (status === 401 || status === 429) throw error;
        }
        if (i < batches.length - 1) await delay(BATCH_DELAY_MS);
    }

    return merged;
}
