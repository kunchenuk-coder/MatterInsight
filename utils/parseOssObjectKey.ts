/** 从 OSS 完整 URL 或 object key 字符串解析出 object key（users/.../file.jpg） */
export function parseOssObjectKey(urlOrKey: string | null | undefined): string | null {
  if (!urlOrKey?.trim()) return null;
  const raw = urlOrKey.trim();
  if (raw.startsWith('users/')) {
    return raw.split('?')[0].split('#')[0];
  }
  try {
    const pathname = new URL(raw).pathname.replace(/^\//, '');
    if (pathname.startsWith('users/')) return pathname;
  } catch {
    const match = raw.match(/(users\/[^?#\s]+)/);
    if (match) return match[1];
  }
  return null;
}

/** 是否为带签名的阿里云 OSS 临时 URL（会过期） */
export function isSignedOssUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    /aliyuncs\.com/i.test(url) &&
    /(?:OSSAccessKeyId|Expires|Signature)=/i.test(url)
  );
}

/** 是否为阿里云 OSS 地址（含 http/https、签名或裸 key） */
export function isOssUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  if (url.trim().startsWith('users/')) return true;
  return /aliyuncs\.com/i.test(url);
}

/** 无需刷新的稳定图片地址（data URL、Unsplash 等）；OSS 一律走签名刷新 */
export function isStableImageUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  if (url.startsWith('data:')) return true;
  if (isOssUrl(url)) return false;
  if (isSignedOssUrl(url)) return false;
  return true;
}
