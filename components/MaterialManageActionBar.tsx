import React from 'react';
import { useTranslation } from 'react-i18next';

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
}) => {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-wrap items-center justify-end gap-2 sm:gap-3 ${className}`}
    >
      <button
        type="button"
        onClick={onSaveDraft}
        disabled={isSavingDraft || isRepublishing}
        className="inline-flex items-center justify-center min-w-[108px] px-5 py-2.5 rounded-xl border-2 border-gray-200 bg-white text-sm font-bold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-sm"
      >
        {isSavingDraft ? t('manage.savingDraft') : t('manage.saveDraft')}
      </button>
      <button
        type="button"
        onClick={onRepublish}
        disabled={isSavingDraft || isRepublishing}
        className="inline-flex items-center justify-center min-w-[108px] px-5 py-2.5 rounded-xl bg-black text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50 transition-all shadow-lg shadow-black/15"
      >
        {isRepublishing ? t('manage.republishing') : t('manage.republish')}
      </button>
    </div>
  );
};

export default MaterialManageActionBar;
