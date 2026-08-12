import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n';

/**
 * Logged-in only language switcher (中 / EN).
 * Preference is persisted via i18n languageChanged → localStorage.
 */
const LanguageSwitcher: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current: AppLanguage = i18n.language?.startsWith('en') ? 'en' : 'zh';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const setLang = (lang: AppLanguage) => {
    void i18n.changeLanguage(lang);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('common.langAria')}
        aria-label={t('common.langAria')}
        aria-expanded={open}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] md:text-xs font-bold border border-gray-200 bg-white text-gray-700 hover:border-black hover:text-black transition-colors"
      >
        <span aria-hidden className="text-sm leading-none">🌐</span>
        <span>{t('common.langSwitch')}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-36 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden z-[60]">
          <button
            type="button"
            onClick={() => setLang('zh')}
            className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-gray-50 ${
              current === 'zh' ? 'text-black bg-gray-50' : 'text-gray-500'
            }`}
          >
            {t('common.langZh')}
          </button>
          <button
            type="button"
            onClick={() => setLang('en')}
            className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-gray-50 ${
              current === 'en' ? 'text-black bg-gray-50' : 'text-gray-500'
            }`}
          >
            {t('common.langEn')}
          </button>
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
