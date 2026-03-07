import { ArxivPaper } from '../types';

/**
 * Fetches the latest AI-related papers from arXiv.
 * Uses a public CORS proxy to bypass cross-origin restrictions (no backend required).
 */
export const fetchLatestAIPapers = async (limit: number = 8): Promise<ArxivPaper[]> => {
  const query = 'cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CV+OR+cat:cs.CL';
  const arxivUrl = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(arxivUrl)}`;

  try {
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('Failed to fetch from arXiv');

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const entries = xmlDoc.getElementsByTagName('entry');

    const papers: ArxivPaper[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const id = entry.getElementsByTagName('id')[0]?.textContent ?? '';
      const title = entry.getElementsByTagName('title')[0]?.textContent?.replace(/\n/g, ' ').trim() ?? '';
      const summary = entry.getElementsByTagName('summary')[0]?.textContent?.replace(/\n/g, ' ').trim() ?? '';
      const published = entry.getElementsByTagName('published')[0]?.textContent ?? '';
      const authors: string[] = Array.from(entry.getElementsByTagName('author')).map(
        (author) => author.getElementsByTagName('name')[0]?.textContent ?? ''
      );
      const link = entry.getElementsByTagName('link')[0]?.getAttribute('href') ?? '';
      const category = entry.getElementsByTagName('category')[0]?.getAttribute('term') ?? '';

      papers.push({ id, title, summary, authors, published, link, category });
    }

    return papers;
  } catch (error) {
    console.error('ArxivService Error:', error);
    throw error;
  }
};
