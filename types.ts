/** Single model option within a provider. */
export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

/** AI provider (e.g. Gemini, DeepSeek) with its models and env key name. */
export interface ProviderOption {
  id: string;
  label: string;
  apiKeyEnv: string; // e.g. 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY'
  models: ModelOption[];
}

/** All supported providers and their models. */
export const SUPPORTED_PROVIDERS: ProviderOption[] = [
  {
    id: 'zhipu',
    label: '智谱 AI (Zhipu AI)',
    apiKeyEnv: 'ZHIPU_API_KEY',
    models: [
      { id: 'glm-4-flash', label: 'GLM-4 Flash', description: '快速' },
      { id: 'glm-4-plus', label: 'GLM-4 Plus', description: '通用' },
      { id: 'glm-4-air', label: 'GLM-4 Air', description: '轻量' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Fast, balanced' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Quick' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Higher quality' },
      { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B', description: 'Lightweight' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', description: 'V3, general' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', description: 'R1, reasoning' },
    ],
  },
];

/** Value for model dropdown: "providerId|modelId". */
export function toModelKey(providerId: string, modelId: string): string {
  return `${providerId}|${modelId}`;
}

export function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const i = key.indexOf('|');
  if (i <= 0 || i === key.length - 1) return null;
  return { providerId: key.slice(0, i), modelId: key.slice(i + 1) };
}

/** Flatten list for dropdown: { value: "providerId|modelId", label, providerId, modelId }. */
export const MODEL_OPTIONS_FLAT = SUPPORTED_PROVIDERS.flatMap((p) =>
  p.models.map((m) => ({
    value: toModelKey(p.id, m.id),
    label: `${p.label} · ${m.label}${m.description ? ` (${m.description})` : ''}`,
    providerId: p.id,
    modelId: m.id,
  }))
);

export const DEFAULT_MODEL_KEY = MODEL_OPTIONS_FLAT[0]?.value ?? 'gemini|gemini-2.0-flash';

/** @deprecated Use SUPPORTED_PROVIDERS / MODEL_OPTIONS_FLAT. Kept for compatibility. */
export const SUPPORTED_GEMINI_MODELS = SUPPORTED_PROVIDERS.find((p) => p.id === 'gemini')?.models ?? [];
export const DEFAULT_GEMINI_MODEL_ID = SUPPORTED_PROVIDERS.find((p) => p.id === 'gemini')?.models[0]?.id ?? 'gemini-2.0-flash';

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  link: string;
  category: string;
  upvotes?: number; // Upvotes from Hugging Face daily papers
}

export interface PaperAnalysis {
  paperId: string;
  summary: string;
  relevanceScore: number; // 1-10
  categories: string[];                    // e.g. ["attention", "llm"]
  categoryScores: Record<string, number>;  // e.g. {"attention": 9, "llm": 6}
}

/** ArxivPaper with optional embedded analysis (as returned by /api/papers). */
export interface PaperWithAnalysis extends ArxivPaper {
  analysis?: PaperAnalysis;
}

/** Category definition (id + display label). */
export interface CategoryInfo {
  id: string;
  label: string;
}

export interface AppState {
  papers: ArxivPaper[];
  analyses: Record<string, PaperAnalysis>;
  isLoading: boolean;
  error: string | null;
}
