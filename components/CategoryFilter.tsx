import React, { useRef } from 'react';
import { CategoryInfo } from '../types';

interface CategoryFilterProps {
  categories: CategoryInfo[];
  selected: string | null; // null = "All"
  onSelect: (categoryId: string | null) => void;
}

const CategoryFilter: React.FC<CategoryFilterProps> = ({ categories, selected, onSelect }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const allTabs: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'All' },
    ...categories.map(c => ({ id: c.id, label: c.label })),
  ];

  return (
    <div className="border-b border-slate-200 bg-white sticky top-[73px] z-40">
      <div
        ref={scrollRef}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto py-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {allTabs.map(tab => (
          <button
            key={tab.id ?? '__all__'}
            onClick={() => onSelect(tab.id)}
            className={`
              flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap
              ${selected === tab.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CategoryFilter;
