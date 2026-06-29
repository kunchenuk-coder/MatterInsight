import { parseOssObjectKey, isSignedOssUrl } from '../utils/parseOssObjectKey';

const MAX_BATCH = 50;

/** 批量向服务端请求 OSS 对象的最新可读 URL */
export async function fetchReadUrlsForObjectKeys(
  objectKeys: string[]
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      objectKeys
        .map((k) => parseOssObjectKey(k))
        .filter((k): k is string => !!k)
    ),
  ];
  if (unique.length === 0) return new Map();

  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += MAX_BATCH) {
    const chunk = unique.slice(i, i + MAX_BATCH);
    try {
      const res = await fetch('/api/get-read-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectKeys: chunk }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { urls?: Record<string, string> };
      for (const [key, url] of Object.entries(json.urls ?? {})) {
        if (url) out.set(key, url);
      }
    } catch (err) {
      console.warn('[assetReadUrlService] batch resolve failed:', err);
    }
  }
  return out;
}

export function resolveUrlFromMap(
  currentUrl: string | null | undefined,
  objectKey: string | null | undefined,
  urlMap: Map<string, string>
): string {
  const key = objectKey ? parseOssObjectKey(objectKey) : parseOssObjectKey(currentUrl);
  if (key && urlMap.has(key)) return urlMap.get(key)!;
  return currentUrl ?? '';
}

/** 收集需要从 OSS 刷新的 object key */
export function collectResolvableOssKeys(
  urls: Array<string | null | undefined>,
  explicitKeys: Array<string | null | undefined> = []
): string[] {
  const keys = new Set<string>();
  for (const key of explicitKeys) {
    const parsed = parseOssObjectKey(key);
    if (parsed) keys.add(parsed);
  }
  for (const url of urls) {
    if (!url || isStableImageUrl(url)) continue;
    const parsed = parseOssObjectKey(url);
    if (parsed) keys.add(parsed);
  }
  return [...keys];
}

function isStableImageUrl(url: string): boolean {
  if (url.startsWith('data:')) return true;
  if (!isSignedOssUrl(url)) return true;
  return false;
}
