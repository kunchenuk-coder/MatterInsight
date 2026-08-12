/**
 * Bilingual content helpers for materials.data fields.
 * Storage: string (legacy) | { zh?, en? }
 * Display: pickLocale — EN falls back to zh; never blank/throw.
 */

import type { AppLanguage } from '../i18n';
import { getAppLanguage } from '../i18n';

export type LocalizedObject = {
  zh?: string | null;
  en?: string | null;
};

/** DB / JSON value for bilingual text fields */
export type LocalizedText = string | LocalizedObject;

export function isLocalizedObject(value: unknown): value is LocalizedObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('zh' in (value as object) || 'en' in (value as object))
  );
}

function clean(s: string | null | undefined): string {
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Resolve display text for the UI language.
 * - en: prefer en, else zh, else ''
 * - zh: prefer zh, else en (rare), else ''
 * Accepts legacy plain strings.
 */
export function pickLocale(
  value: LocalizedText | null | undefined,
  lang: AppLanguage = getAppLanguage()
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (!isLocalizedObject(value)) return '';
  const zh = clean(value.zh);
  const en = clean(value.en);
  if (lang === 'en') return en || zh;
  return zh || en;
}

/** Pack zh + optional en for persistence. Omits empty en; returns plain string if no en. */
export function packLocalized(zh: string, en?: string | null): LocalizedText {
  const z = clean(zh);
  const e = clean(en ?? undefined);
  if (!e) return z;
  return { zh: z, en: e };
}

/** Split a stored field into form zh / en strings */
export function unpackLocalized(value: LocalizedText | null | undefined): {
  zh: string;
  en: string;
} {
  if (value == null) return { zh: '', en: '' };
  if (typeof value === 'string') return { zh: value, en: '' };
  return { zh: clean(value.zh), en: clean(value.en) };
}

/** Stable identity for equality / vote APIs (prefer zh) */
export function tagIdentity(value: LocalizedText | null | undefined): string {
  return pickLocale(value, 'zh') || pickLocale(value, 'en');
}
