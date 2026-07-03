import React from 'react';

interface MaterialManageActionBarProps {
  onSaveDraft: () => void;
  onRepublish: () => void;
  isSavingDraft?: boolean;
  isRepublishing?: boolean;
  className?: string;
}

export const MaterialManageActionBar: React.FC<MaterialManageActionBarProps> = ({
  onSaveDraft,
  onRepublish,
  isSavingDraft = false,
  isRepublishing = false,
  className = '',
}) => (
  <div
    className={`flex flex-wrap items-center justify-end gap-2 sm:gap-3 ${className}`}
  >
    <button
      type="button"
      onClick={onSaveDraft}
      disabled={isSavingDraft || isRepublishing}
      className="inline-flex items-center justify-center min-w-[108px] px-5 py-2.5 rounded-xl border-2 border-gray-200 bg-white text-sm font-bold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-sm"
    >
      {isSavingDraft ? '保存中…' : '保存草稿'}
    </button>
    <button
      type="button"
      onClick={onRepublish}
      disabled={isSavingDraft || isRepublishing}
      className="inline-flex items-center justify-center min-w-[108px] px-5 py-2.5 rounded-xl bg-black text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50 transition-all shadow-lg shadow-black/15"
    >
      {isRepublishing ? '发布中…' : '再次发布'}
    </button>
  </div>
);

export default MaterialManageActionBar;
