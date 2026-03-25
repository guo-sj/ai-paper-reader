import { GoogleGenAI, Type } from "@google/genai";
import { ArxivPaper, PaperAnalysis, DEFAULT_GEMINI_MODEL_ID } from '../types';

/** Max papers per API call to avoid token/rate limits. */
const BATCH_SIZE = 3;

/** Delay in ms between batches to reduce rate-limit risk. */
const BATCH_DELAY_MS = 500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves the model ID to use (passed value, then env, then default).
 */
function resolveModelId(modelId?: string): string {
  if (modelId) return modelId;
  const envModel =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_MODEL) ||
    (typeof process !== 'undefined' && process.env?.VITE_GEMINI_MODEL);
  return envModel || DEFAULT_GEMINI_MODEL_ID;
}

/**
 * Analyzes a single batch of papers with Gemini.
 */
async function analyzeBatch(
  ai: GoogleGenAI,
  batch: ArxivPaper[],
  modelId: string,
  categoryIds: string[]
): Promise<Record<string, PaperAnalysis>> {
  const categoryList = categoryIds.join(', ');
  const prompt = `
    请分析以下来自 arXiv 的最新 AI 研究论文。
    请务必使用 **中文** 提供 JSON 格式的结构化分析。

    分析重点包括：
    1. 用 50~150 字的中文写一段综合摘要（summary），涵盖：该论文解决的核心问题、采用的关键方法和技术创新点，以及对 AI 领域的潜在影响，要求信息密度高，让专家一眼能看出论文讲了什么。
    2. 针对普通 AI 研究者的相关度评分（relevanceScore，1-10分）。
    3. 从以下预定义类别中，选出该论文最相关的 1-3 个类别，并给出每个类别的相关度评分（1-10）。
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
  `;

  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            paperId: { type: Type.STRING, description: "The full arXiv ID as provided." },
            summary: { type: Type.STRING, description: "50~150字中文综合摘要，涵盖核心问题、方法创新和潜在影响。" },
            relevanceScore: { type: Type.NUMBER, description: "Score from 1 to 10." },
            categories: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Selected category IDs (1-3)." },
            categoryScores: { type: Type.OBJECT, description: "Map of category ID to relevance score (1-10)." }
          },
          required: ["paperId", "summary", "relevanceScore", "categories", "categoryScores"]
        }
      }
    }
  });

  const resultText = response.text?.trim() || "[]";
  const cleanJson = resultText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const analysesArray: PaperAnalysis[] = JSON.parse(cleanJson);

  const record: Record<string, PaperAnalysis> = {};
  analysesArray.forEach((analysis) => {
    if (analysis && analysis.paperId) {
      record[analysis.paperId] = {
        paperId: analysis.paperId,
        summary: String(analysis.summary ?? ''),
        relevanceScore: Number(analysis.relevanceScore) || 0,
        categories: Array.isArray(analysis.categories) ? analysis.categories : [],
        categoryScores: (analysis.categoryScores && typeof analysis.categoryScores === 'object' && !Array.isArray(analysis.categoryScores))
          ? Object.fromEntries(Object.entries(analysis.categoryScores).map(([k, v]) => [k, Number(v) || 0]))
          : {},
      };
    }
  });
  return record;
}

/**
 * Splits an array into chunks of at most `size` elements.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Uses Gemini to analyze papers in batches to avoid token/rate limits.
 * @param papers - Papers to analyze.
 * @param modelId - Optional Gemini model ID (e.g. gemini-2.0-flash). Falls back to env VITE_GEMINI_MODEL or default.
 */
export const analyzePapers = async (
  papers: ArxivPaper[],
  modelId?: string,
  categoryIds: string[] = []
): Promise<Record<string, PaperAnalysis>> => {
  if (papers.length === 0) return {};

  if (!process.env.API_KEY) {
    console.error('Gemini API Key is missing. Please ensure process.env.API_KEY is set.');
    return {};
  }

  const model = resolveModelId(modelId);
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const batches = chunk(papers, BATCH_SIZE);
  const merged: Record<string, PaperAnalysis> = {};

  for (let i = 0; i < batches.length; i++) {
    try {
      const batchResult = await analyzeBatch(ai, batches[i], model, categoryIds);
      Object.assign(merged, batchResult);
    } catch (error) {
      console.error(`GeminiService batch ${i + 1}/${batches.length} failed:`, error);
      // Continue with other batches; merged still contains previous successes
    }
    if (i < batches.length - 1) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return merged;
};
