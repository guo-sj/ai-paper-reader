import { ArxivPaper, PaperAnalysis, SUPPORTED_PROVIDERS } from '../types';
import { analyzePapers as geminiAnalyzePapers } from './geminiService';
import { analyzePapers as deepseekAnalyzePapers } from './deepseekService';
import { analyzePapers as zhipuAnalyzePapers } from './zhipuService';

function getEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name] !== undefined) {
    return process.env[name];
  }
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.[name] !== undefined) {
    return (import.meta as any).env[name];
  }
  return undefined;
}

/**
 * Analyzes papers using the specified provider and model.
 * @param papers - Papers to analyze.
 * @param providerId - e.g. 'gemini', 'deepseek'.
 * @param modelId - Model id for that provider (e.g. 'gemini-2.0-flash', 'deepseek-chat').
 */
export async function analyzePapers(
  papers: ArxivPaper[],
  providerId: string,
  modelId: string
): Promise<Record<string, PaperAnalysis>> {
  if (papers.length === 0) return {};

  const provider = SUPPORTED_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) {
    console.error(`Unknown provider: ${providerId}`);
    return {};
  }

  const apiKey = getEnv(provider.apiKeyEnv);
  if (!apiKey?.trim()) {
    console.error(`API Key missing for ${provider.label}. Set ${provider.apiKeyEnv}.`);
    return {};
  }

  if (providerId === 'gemini') {
    return geminiAnalyzePapers(papers, modelId);
  }

  if (providerId === 'deepseek') {
    return deepseekAnalyzePapers(papers, modelId, apiKey);
  }

  if (providerId === 'zhipu') {
    return zhipuAnalyzePapers(papers, modelId, apiKey);
  }

  console.error(`No implementation for provider: ${providerId}`);
  return {};
}

/**
 * Returns whether the given provider has an API key set.
 */
export function hasApiKeyForProvider(providerId: string): boolean {
  const provider = SUPPORTED_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return false;
  const key = getEnv(provider.apiKeyEnv);
  return !!key?.trim();
}
