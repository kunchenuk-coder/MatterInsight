import { Category, Material } from '../types';
import { pickLocale } from './localizedText';

/**
 * Category search aliases (codes + EN/ZH names).
 * Exact code match (e.g. "st") or longer alias substring match (e.g. "stone").
 */
export const CATEGORY_SEARCH_ALIASES: Record<Category, string[]> = {
  [Category.ST]: ['st', 'stone', '石材'],
  [Category.CT]: ['ct', 'tile', '瓷砖'],
  [Category.CO]: ['co', 'cement', '水泥'],
  [Category.SF]: ['sf', 'finish', '饰面'],
  [Category.WD]: ['wd', 'wood', '木材', '木'],
  [Category.GL]: ['gl', 'glass', '玻璃'],
  [Category.MT]: ['mt', 'metal', '金属'],
  [Category.PVC]: ['pvc', 'plastic', '塑料'],
  [Category.FB]: ['fb', 'fabric', '面料'],
  [Category.CP]: ['cp', 'carpet', '地毯'],
  [Category.L]: ['l', 'lighting', '灯光', '灯'],
  [Category.Other]: ['other', '其他'],
};

export function categoryMatchesSearchQuery(category: Category, query: string): boolean {
  const q = query.toLowerCase();
  if (!q) return true;
  if (category.toLowerCase().includes(q)) return true;
  const aliases = CATEGORY_SEARCH_ALIASES[category] ?? [];
  return aliases.some(
    (alias) => alias === q || (alias.length > 2 && (alias.includes(q) || q.includes(alias)))
  );
}

export function materialMatchesSearchQuery(
  m: Pick<Material, 'name' | 'brand' | 'specifications' | 'category'>,
  searchTerm: string
): boolean {
  if (!searchTerm) return true;
  const q = searchTerm.toLowerCase();
  const nameZh = pickLocale(m.name, 'zh').toLowerCase();
  const nameEn = pickLocale(m.name, 'en').toLowerCase();
  return (
    nameZh.includes(q) ||
    nameEn.includes(q) ||
    m.brand.toLowerCase().includes(q) ||
    m.specifications.toLowerCase().includes(q) ||
    categoryMatchesSearchQuery(m.category, q)
  );
}
