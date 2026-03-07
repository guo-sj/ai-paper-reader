
import React, { useState } from 'react';
import { ArxivPaper, PaperAnalysis } from '../types';

interface PaperCardProps {
  paper: ArxivPaper;
  analysis?: PaperAnalysis;
  isLoadingAnalysis: boolean;
}

const PaperCard: React.FC<PaperCardProps> = ({ paper, analysis, isLoadingAnalysis }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formattedDate = new Date(paper.published).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md hover:border-blue-200">
      <div className="p-5">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-blue-50 text-blue-600 text-xs font-semibold rounded uppercase tracking-wider">
              {paper.category}
            </span>
            {paper.upvotes !== undefined && paper.upvotes > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 text-xs font-semibold rounded">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                </svg>
                {paper.upvotes}
              </span>
            )}
          </div>
          <span className="text-slate-400 text-xs">{formattedDate}</span>
        </div>
        
        <h3 className="mt-3 text-lg font-bold text-slate-900 leading-snug">
          <a href={paper.link} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">
            {paper.title}
          </a>
        </h3>
        
        <p className="mt-2 text-sm text-slate-500 line-clamp-2">
          By {paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}
        </p>

        {isLoadingAnalysis ? (
          <div className="mt-6 space-y-3 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-3/4"></div>
            <div className="h-4 bg-slate-100 rounded w-full"></div>
            <div className="h-4 bg-slate-100 rounded w-5/6"></div>
          </div>
        ) : analysis ? (
          <div className="mt-6 space-y-4">
            <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <h4 className="text-xs font-bold text-blue-800 uppercase tracking-widest">AI Summary</h4>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed italic">
                "{analysis.geminiSummary}"
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Key Innovation</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{analysis.keyInnovation}</p>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Impact</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{analysis.potentialImpact}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">Relevance:</span>
                <span className={`text-xs font-bold ${analysis.relevanceScore >= 8 ? 'text-green-500' : 'text-slate-600'}`}>
                  {analysis.relevanceScore}/10
                </span>
              </div>
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                {isExpanded ? 'Show Less' : 'View Abstract'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 py-4 text-center border-t border-slate-50">
            <p className="text-xs text-slate-400">Analysis currently unavailable</p>
          </div>
        )}

        {isExpanded && (
          <div className="mt-4 p-4 bg-slate-50 rounded text-xs text-slate-600 leading-relaxed animate-in fade-in slide-in-from-top-2 duration-300">
            <h4 className="font-bold mb-1">Abstract</h4>
            {paper.summary}
          </div>
        )}
      </div>
    </div>
  );
};

export default PaperCard;
