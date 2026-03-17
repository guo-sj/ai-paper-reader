import React, { useState, useEffect, useCallback } from 'react';
import { fetchLatestAIPapers, fetchCategories, PapersResponse, CategoriesResponse } from './services/huggingFaceService';
import { getCachedPapers, setCachedPapers } from './services/papersCache';
import { DEFAULT_CACHE_TTL_MS } from './services/cacheStore';
import { PaperWithAnalysis, CategoryInfo } from './types';
import PaperCard from './components/PaperCard';
import CategoryFilter from './components/CategoryFilter';
import SubscriptionForm from './components/SubscriptionForm';

const PAPER_CACHE_MAX_AGE_MS = DEFAULT_CACHE_TTL_MS;
const TOP_N = 5;

interface ScoringWeights {
  w_upvotes: number;
  w_relevance: number;
  w_category: number;
}

function computeFinalScore(
  paper: PaperWithAnalysis,
  category: string | null,
  allPapers: PaperWithAnalysis[],
  weights: ScoringWeights
): number {
  const maxUpvotes = Math.max(1, allPapers.reduce((m, p) => Math.max(m, p.upvotes ?? 0), 0));
  const u = Math.min(paper.upvotes ?? 0, maxUpvotes) / maxUpvotes;
  const r = (paper.analysis?.relevanceScore ?? 0) / 10;
  const c = category
    ? (paper.analysis?.categoryScores?.[category] ?? 0) / 10
    : 0.5;
  return weights.w_upvotes * u + weights.w_relevance * r + weights.w_category * c;
}

function isHiddenGem(paper: PaperWithAnalysis): boolean {
  if (!paper.analysis?.categoryScores) return false;
  const scores = Object.values(paper.analysis.categoryScores);
  const maxCatScore = scores.length > 0 ? scores.reduce((m, v) => Math.max(m, v), 0) : 0;
  return maxCatScore >= 9 && (paper.upvotes ?? 0) < 20;
}

function getCategoryFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('category');
}

function setCategoryInUrl(categoryId: string | null): void {
  const params = new URLSearchParams(window.location.search);
  if (categoryId) {
    params.set('category', categoryId);
  } else {
    params.delete('category');
  }
  const newUrl = params.toString()
    ? `${window.location.pathname}?${params}`
    : window.location.pathname;
  window.history.pushState({}, '', newUrl);
}

const App: React.FC = () => {
  const [papers, setPapers] = useState<PaperWithAnalysis[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [scoring, setScoring] = useState<ScoringWeights>({ w_upvotes: 0.3, w_relevance: 0.3, w_category: 0.4 });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(getCategoryFromUrl);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load categories on mount
  useEffect(() => {
    fetchCategories()
      .then(({ categories: cats, scoring: sc }) => {
        setCategories(cats);
        setScoring(sc);
      })
      .catch(err => console.warn('Failed to load categories:', err));
  }, []);

  const loadData = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setLoadingPapers(true);
      setError(null);

      let papersToUse: PaperWithAnalysis[] = [];
      if (!forceRefresh) {
        const cached = getCachedPapers(PAPER_CACHE_MAX_AGE_MS);
        if (!cached.isStale && cached.papers.length > 0) {
          papersToUse = cached.papers;
        }
      }

      if (papersToUse.length === 0) {
        const { papers: fetched } = await fetchLatestAIPapers(forceRefresh);
        papersToUse = fetched;
        setCachedPapers(fetched);
      }

      setPapers(papersToUse);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoadingPapers(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Sync URL on category change
  const handleCategorySelect = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    setCategoryInUrl(categoryId);
  };

  // Browser back/forward support
  useEffect(() => {
    const onPopState = () => setSelectedCategory(getCategoryFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Compute displayed papers
  const displayedPapers = (() => {
    const maxUpvotes = Math.max(1, papers.reduce((m, p) => Math.max(m, p.upvotes ?? 0), 0));
    const score = (paper: PaperWithAnalysis, category: string | null) => {
      const u = Math.min(paper.upvotes ?? 0, maxUpvotes) / maxUpvotes;
      const r = (paper.analysis?.relevanceScore ?? 0) / 10;
      const c = category
        ? (paper.analysis?.categoryScores?.[category] ?? 0) / 10
        : 0.5;
      return scoring.w_upvotes * u + scoring.w_relevance * r + scoring.w_category * c;
    };

    if (selectedCategory === null) {
      return [...papers].sort((a, b) => score(b, null) - score(a, null));
    }
    const filtered = papers.filter(p =>
      p.analysis?.categories?.includes(selectedCategory)
    );
    return filtered
      .sort((a, b) => score(b, selectedCategory) - score(a, selectedCategory))
      .slice(0, TOP_N);
  })();

  const selectedCategoryLabel = selectedCategory
    ? categories.find(c => c.id === selectedCategory)?.label ?? selectedCategory
    : null;

  const categoryPaperCount = selectedCategory
    ? papers.filter(p => p.analysis?.categories?.includes(selectedCategory)).length
    : papers.length;

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
              disabled={loadingPapers}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-2"
            >
              {loadingPapers ? (
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {loadingPapers ? '获取中...' : '刷新'}
            </button>
          </div>
        </div>
      </header>

      {/* Category Filter */}
      {!loadingPapers && categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={handleCategorySelect}
        />
      )}

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
            <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">
                  {selectedCategoryLabel ? selectedCategoryLabel : 'Latest Discoveries'}
                </h2>
                {selectedCategory ? (
                  displayedPapers.length > 0 ? (
                    <p className="text-slate-500 mt-1">
                      Top {displayedPapers.length} / 共 {categoryPaperCount} 篇 · {selectedCategoryLabel}
                    </p>
                  ) : (
                    <p className="text-slate-500 mt-1">今日暂无「{selectedCategoryLabel}」的论文，试试其他类别？</p>
                  )
                ) : (
                  <p className="text-slate-500 mt-1">Found {papers.length} groundbreaking papers from today's releases.</p>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-full border border-green-100">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  Live Feed
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100">
                  GPT-4o Enhanced
                </div>
              </div>
            </div>

            {displayedPapers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayedPapers.map((paper, index) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    analysis={paper.analysis}
                    rank={selectedCategory && index < 3 ? index + 1 : undefined}
                    isHiddenGem={isHiddenGem(paper)}
                  />
                ))}
              </div>
            ) : !selectedCategory && (
              <div className="text-center py-20">
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
