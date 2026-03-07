import { ArxivPaper, PaperAnalysis } from '../types';

const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildPrompt(batch: ArxivPaper[]): string {
  return `
请分析以下来自 arXiv 的最新 AI 研究论文。
请务必使用 **中文** 提供 JSON 格式的结构化分析。
必须返回一个 JSON 数组，每个元素包含字段：paperId（与下方 ID 一致）、geminiSummary、keyInnovation、potentialImpact、relevanceScore（1-10 的数字）。

分析重点包括：
1. 核心方法论的简洁摘要（geminiSummary）。
2. 与之前工作相比的关键创新点（keyInnovation）。
3. 对 AI 领域的长期潜在影响（potentialImpact）。
4. 针对普通 AI 研究者的相关度评分（relevanceScore，1-10分）。

待分析论文：
${batch.map((p) => `
---
ID: ${p.id}
标题: ${p.title}
摘要: ${p.summary}
`).join('\n')}

请直接返回 JSON 数组，不要其他说明。例如：[{"paperId":"...","geminiSummary":"...","keyInnovation":"...","potentialImpact":"...","relevanceScore":8}, ...]
`.trim();
}

async function analyzeBatch(
  apiKey: string,
  batch: ArxivPaper[],
  modelId: string
): Promise<Record<string, PaperAnalysis>> {
  const res = await fetch(`${ZHIPU_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
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
      res.status === 402
        ? `智谱 AI 余额不足 (402)：${message}。请前往智谱控制台充值后重试。`
        : res.status === 401
          ? `智谱 AI API 密钥无效 (401)：${message}。请检查 ZHIPU_API_KEY。`
          : res.status === 429
            ? `智谱 AI 请求过于频繁 (429)：${message}。请稍后再试。`
            : `智谱 AI API ${res.status}: ${message}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() || '{}';
  const cleanJson = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJson);
  } catch {
    throw new Error('智谱 AI returned invalid JSON');
  }

  const arr = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).items ?? (parsed as Record<string, unknown>).analyses ?? [];
  if (!Array.isArray(arr)) {
    throw new Error('智谱 AI response is not a JSON array');
  }

  const record: Record<string, PaperAnalysis> = {};
  for (const a of arr) {
    const analysis = a as Record<string, unknown>;
    const paperId = analysis?.paperId as string | undefined;
    if (!paperId) continue;
    record[paperId] = {
      paperId,
      geminiSummary: String(analysis.geminiSummary ?? ''),
      keyInnovation: String(analysis.keyInnovation ?? ''),
      potentialImpact: String(analysis.potentialImpact ?? ''),
      relevanceScore: Number(analysis.relevanceScore) || 0,
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

/**
 * Analyzes papers using Zhipu AI API (OpenAI-compatible).
 */
export async function analyzePapers(
  papers: ArxivPaper[],
  modelId: string,
  apiKey: string
): Promise<Record<string, PaperAnalysis>> {
  if (papers.length === 0) return {};
  if (!apiKey?.trim()) {
    console.error('Zhipu AI API Key is missing.');
    return {};
  }

  const batches = chunk(papers, BATCH_SIZE);
  const merged: Record<string, PaperAnalysis> = {};

  for (let i = 0; i < batches.length; i++) {
    try {
      const batchResult = await analyzeBatch(apiKey, batches[i], modelId);
      Object.assign(merged, batchResult);
    } catch (error) {
      console.error(`Zhipu AI batch ${i + 1}/${batches.length} failed:`, error);
      const status = (error as Error & { status?: number })?.status;
      if (status === 402 || status === 401 || status === 429) {
        throw error;
      }
    }
    if (i < batches.length - 1) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return merged;
}
