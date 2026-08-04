import { parseOssObjectKey, isSignedOssUrl, isOssUrl } from '../utils/parseOssObjectKey';

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
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(
          `[assetReadUrlService] get-read-url HTTP ${res.status}:`,
          errText.slice(0, 200)
        );
        continue;
      }
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
  if (!currentUrl) return '';
  // 签名 URL 过期且刷新失败：不可用
  if (isSignedOssUrl(currentUrl)) return '';
  // 公网 OSS http → https，避免 Vercel HTTPS 页混合内容空白
  if (isOssUrl(currentUrl) && /^http:\/\//i.test(currentUrl)) {
    return currentUrl.replace(/^http:\/\//i, 'https://');
  }
  // 未签名的 https OSS / 稳定外链：保留，避免刷新失败把主图清空
  return currentUrl;
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
  if (/aliyuncs\.com/i.test(url) || url.startsWith('users/')) return false;
  if (!isSignedOssUrl(url)) return true;
  return false;
}

/** 将 profiles.avatar（object key 或过期签名 URL）解析为当前可读地址 */
export async function resolveProfileAvatarUrl(
  stored: string | null | undefined
): Promise<string | null> {
  if (!stored?.trim()) return null;
  const raw = stored.trim();
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  const key = parseOssObjectKey(raw);
  if (!key) return raw;
  const map = await fetchReadUrlsForObjectKeys([key]);
  const resolved = resolveUrlFromMap(raw, key, map);
  return resolved || null;
}
