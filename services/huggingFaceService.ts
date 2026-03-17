import { PaperWithAnalysis, CategoryInfo } from '../types';

export type { PaperWithAnalysis, CategoryInfo };

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
