import { ArxivPaper } from '../types';

/**
 * Fetches the latest AI papers from Hugging Face Daily Papers.
 * Uses the backend API endpoint which handles the Hugging Face fetch.
 * This avoids CORS issues since the Vite proxy forwards /api/* to the backend.
 */
export const fetchLatestAIPapers = async (limit: number = 10, refresh: boolean = false): Promise<ArxivPaper[]> => {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (refresh) params.set('refresh', 'true');
    const response = await fetch(`/api/papers?${params}`);
    if (!response.ok) throw new Error('Failed to fetch from backend API');

    const data = (await response.json()) as ArxivPaper[];
    return data.slice(0, limit);
  } catch (error) {
    console.error('HuggingFaceService Error:', error);
    throw error;
  }
};
