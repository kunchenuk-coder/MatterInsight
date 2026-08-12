
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Category } from '../types';
import { CATEGORIES } from '../constants.tsx';

interface CategoryBarProps {
  selected: Category | null;
  onSelect: (cat: Category | null) => void;
}

const CategoryBar: React.FC<CategoryBarProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <div className="sticky top-16 bg-white/95 backdrop-blur-sm z-40 py-6 mb-4 flex items-center gap-3 overflow-x-auto no-scrollbar whitespace-nowrap -mx-4 px-4 md:-mx-8 md:px-8 border-b">
      <button
        onClick={() => onSelect(null)}
        className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
          selected === null ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-600 border hover:border-black'
        }`}
      >
        {t('explore.allRecommended')}
      </button>
      {CATEGORIES.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
            selected === cat ? 'bg-black text-white shadow-lg' : 'bg-white text-gray-600 border hover:border-black'
          }`}
        >
          {t(`category.${cat}`, { defaultValue: cat })}
        </button>
      ))}
    </div>
  );
};

export default CategoryBar;
