
import React, { useState, useEffect, useCallback } from 'react';
import { fetchLatestAIPapers } from './services/huggingFaceService';
import { getCachedAnalyses, mergeCachedAnalyses } from './services/analysisCache';
import { getCachedPapers, setCachedPapers } from './services/papersCache';
import { DEFAULT_CACHE_TTL_MS } from './services/cacheStore';
import { ArxivPaper, PaperAnalysis } from './types';
import PaperCard from './components/PaperCard';
import SubscriptionForm from './components/SubscriptionForm';

const PAPER_CACHE_MAX_AGE_MS = DEFAULT_CACHE_TTL_MS;
const ANALYSIS_CACHE_KEY = 'openai';

/** Normalize API result to be keyed by paper.id for consistent cache/UI lookup. */
function normalizeAnalysesByPaperId(
  papers: ArxivPaper[],
  result: Record<string, PaperAnalysis>
): Record<string, PaperAnalysis> {
  const normalized: Record<string, PaperAnalysis> = {};
  for (const paper of papers) {
    const a = result[paper.id] ?? Object.values(result).find((x) => x.paperId === paper.id || x.paperId?.endsWith(paper.id) || paper.id.endsWith(x.paperId ?? ''));
    if (a) normalized[paper.id] = a;
  }
  return normalized;
}

const App: React.FC = () => {
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, PaperAnalysis>>({});
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAnalyses(getCachedAnalyses(ANALYSIS_CACHE_KEY));
  }, []);

  const loadData = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setLoadingPapers(true);
      setError(null);

      let papersToUse: ArxivPaper[] = [];
      if (!forceRefresh) {
        const cached = getCachedPapers(10, PAPER_CACHE_MAX_AGE_MS);
        if (!cached.isStale && cached.papers.length > 0) {
          papersToUse = cached.papers;
        }
      }

      if (papersToUse.length === 0) {
        const fetchedPapers = await fetchLatestAIPapers(10, forceRefresh);
        papersToUse = fetchedPapers;
        setCachedPapers(fetchedPapers);
        console.log('Fetched papers:', fetchedPapers.map(p => ({ title: p.title, upvotes: p.upvotes })));
      }

      setPapers(papersToUse);
      setLoadingPapers(false);

      if (papersToUse.length === 0) return;

      const cached = getCachedAnalyses(ANALYSIS_CACHE_KEY);
      setAnalyses(cached);

      const missingPapers = papersToUse.filter((p) => !cached[p.id]);
      if (missingPapers.length === 0) return;

      setLoadingAnalysis(true);
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ papers: missingPapers }),
      });

      if (!response.ok) {
        const errData = await response.json() as { error?: string };
        throw new Error(errData.error || '论文分析失败');
      }

      const results = await response.json() as Record<string, PaperAnalysis>;
      const normalized = normalizeAnalysesByPaperId(missingPapers, results);
      setAnalyses((prev) => ({ ...prev, ...normalized }));
      mergeCachedAnalyses(ANALYSIS_CACHE_KEY, normalized);
      setLoadingAnalysis(false);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setLoadingPapers(false);
      setLoadingAnalysis(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              disabled={loadingPapers || loadingAnalysis}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {(loadingPapers || loadingAnalysis) ? (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {loadingPapers ? '获取中...' : loadingAnalysis ? '分析中...' : '刷新'}
            </button>
          </div>
        </div>
      </header>

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
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Latest Discoveries</h2>
                <p className="text-slate-500 mt-1">Found {papers.length} groundbreaking papers from today's releases.</p>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-full border border-green-100">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  Live Feed
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.047a1 1 0 01.897.95l.141 2.655 2.503-.835a1 1 0 011.233.565l1.023 2.193a1 1 0 01-.3 1.258l-2.14 1.583 1.413 2.298a1 1 0 01-.15 1.3l-2.19 1.954 1.135 2.454a1 1 0 01-.58 1.282l-2.192.836-.142 2.654a1 1 0 01-1 1H8.718a1 1 0 01-.999-.949l-.142-2.654-2.192-.836a1 1 0 01-.58-1.282l1.135-2.454-2.19-1.954a1 1 0 01-.15-1.3l1.413-2.298-2.14-1.583a1 1 0 01-.3-1.258l1.023-2.193a1 1 0 011.233-.565l2.503.835.141-2.655a1 1 0 01.999-.95h2.583z" clipRule="evenodd" />
                  </svg>
                  GPT-4o Enhanced
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {papers.map((paper) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  analysis={analyses[paper.id]}
                  isLoadingAnalysis={loadingAnalysis && !analyses[paper.id]}
                />
              ))}
            </div>

            {papers.length === 0 && !loadingPapers && (
              <div className="text-center py-20">
                <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
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
