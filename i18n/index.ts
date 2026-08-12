import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

export const LANG_STORAGE_KEY = 'matter_insight_lang';
export type AppLanguage = 'zh' | 'en';

export function readStoredLanguage(): AppLanguage {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (raw === 'en' || raw === 'zh') return raw;
  } catch {
    /* ignore */
  }
  return 'zh';
}

/** Current UI language for prompts / display (defaults to zh). */
export function getAppLanguage(): AppLanguage {
  const lng = i18n.language || readStoredLanguage();
  return lng.startsWith('en') ? 'en' : 'zh';
}

export function persistLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: readStoredLanguage(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  returnNull: false,
});

persistLanguage(i18n.language === 'en' ? 'en' : 'zh');

i18n.on('languageChanged', (lng) => {
  persistLanguage(lng === 'en' ? 'en' : 'zh');
});

export default i18n;
