/** Mock blocklist for custom mood-tag moderation. */
const MALICIOUS_MOOD_WORDS = [
  '垃圾',
  '骗子',
  '傻逼',
  '操',
  'fuck',
  'shit',
  'spam',
  '广告',
];

export const MOOD_TAG_RELIABILITY_PENALTY = 5;
/** Max custom mood tags a single designer may add per material */
export const MAX_DESIGNER_CUSTOM_MOOD_TAGS = 3;
/** Max official brand mood tags a supplier may set per material */
export const MAX_SUPPLIER_BRAND_MOOD_TAGS = 3;
/** @deprecated use MAX_DESIGNER_CUSTOM_MOOD_TAGS */
export const MAX_CUSTOM_MOOD_TAGS = MAX_DESIGNER_CUSTOM_MOOD_TAGS;

export function containsMaliciousMoodWord(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return MALICIOUS_MOOD_WORDS.some((word) => normalized.includes(word.toLowerCase()));
}

export function applyReliabilityPenalty(currentScore: number, penalty = MOOD_TAG_RELIABILITY_PENALTY): number {
  return Math.max(0, currentScore - penalty);
}
