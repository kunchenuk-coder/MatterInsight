export type DeviceType = 'mobile' | 'desktop';

const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i;

/** 根据 User-Agent / 触控能力判定手机或桌面端 */
export function detectDeviceType(userAgent?: string): DeviceType {
  if (typeof navigator === 'undefined') {
    return 'desktop';
  }

  const ua = userAgent ?? navigator.userAgent;
  const isIPad =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (MOBILE_UA_RE.test(ua) || isIPad) {
    return 'mobile';
  }
  return 'desktop';
}
