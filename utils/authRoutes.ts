export type PublicAuthPath = '/login' | '/reset-password' | '/admin';

/** 隐藏的管理员入口路径（普通登录页不暴露管理端） */
export const ADMIN_PORTAL_PATH = '/admin';

/**
 * 是否为「管理员入口」：
 *   1) 域名以 admin 开头或包含 admin（如 matterinsightadmin.vercel.app / admin.xxx.com）；
 *   2) 或访问隐藏路径 /admin。
 * 普通登录页（设计师 / 材料商）不会命中此判断，从而隐藏管理端入口。
 */
export function isAdminPortal(): boolean {
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  const onAdminHost = host.startsWith('admin') || host.includes('admin');
  const onAdminPath = path === ADMIN_PORTAL_PATH || path.startsWith('/admin/');
  return onAdminHost || onAdminPath;
}

/** 内存标记：Supabase 解析 hash 后 URL 可能不再含 type=recovery，需保持 recovery 状态 */
let recoveryModeLocked = false;

export function getPathname(): string {
  return window.location.pathname;
}

export function isResetPasswordRoute(pathname = getPathname()): boolean {
  const normalized = pathname.toLowerCase();
  return normalized === '/reset-password' || normalized.endsWith('/reset-password');
}

export function isAuthRoute(pathname = getPathname()): boolean {
  const normalized = pathname.toLowerCase();
  return (
    normalized === '/' ||
    normalized === '/login' ||
    normalized.endsWith('/login')
  );
}

export function isPasswordRecoveryFromUrl(): boolean {
  const hash = window.location.hash.toLowerCase();
  const search = window.location.search.toLowerCase();
  return hash.includes('type=recovery') || search.includes('type=recovery');
}

/**
 * 是否处于「密码找回 / 恢复」模式（最高优先级，阻断一切自动登录进主页）。
 */
export function isPasswordRecoveryMode(): boolean {
  return (
    recoveryModeLocked ||
    isPasswordRecoveryFromUrl() ||
    isResetPasswordRoute()
  );
}

/** @param locked true=进入 recovery；false=清除 recovery 锁定 */
export function lockPasswordRecoveryMode(locked = true): void {
  recoveryModeLocked = locked;
}

export function unlockPasswordRecoveryMode(): void {
  lockPasswordRecoveryMode(false);
}

/**
 * 检测 /reset-password 路径或 URL hash 含 type=recovery → 锁定 recovery 模式。
 * 应在应用最早阶段同步调用（index.tsx）。
 */
export const ensureRecoveryRoute = (): boolean => {
  const onResetPath =
    window.location.pathname === '/reset-password' ||
    window.location.pathname.endsWith('/reset-password');
  const hasRecoveryHash = window.location.hash.includes('type=recovery');

  if (!onResetPath && !hasRecoveryHash) return false;

  lockPasswordRecoveryMode(true);

  if (hasRecoveryHash && !onResetPath) {
    const { search, hash } = window.location;
    window.history.replaceState(null, '', `/reset-password${search}${hash}`);
  }

  return true;
};

export function navigateTo(path: PublicAuthPath): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** 必须返回完整的重置页面路径，供 Supabase 邮件 redirectTo 使用 */
export const getPasswordResetRedirectUrl = (): string => {
  return `${window.location.origin}/reset-password`;
};

/** 重置完成或取消：清除 recovery 并硬刷新到登录页 */
export function redirectToLoginAfterReset(): void {
  unlockPasswordRecoveryMode();
  window.location.href = '/';
}

export function cancelPasswordRecovery(): void {
  redirectToLoginAfterReset();
}
