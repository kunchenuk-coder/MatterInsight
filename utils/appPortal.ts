/**
 * 三端 Auth 门户标识（仅隔离登录 Session，共享同一 Supabase 数据源）。
 *
 * designer / supplier / admin 各自独立 storageKey，互不覆盖。
 */

import { ADMIN_DASHBOARD_PATH, ADMIN_PORTAL_PATH } from './authRoutes';

export type AppPortal = 'designer' | 'supplier' | 'admin';

/** Supabase Auth persistSession 的独立 storageKey（勿与业务数据表混淆） */
export const AUTH_STORAGE_KEYS: Record<AppPortal, string> = {
  designer: 'designer-auth-session',
  supplier: 'supplier-auth-session',
  admin: 'admin-auth-session',
};

const SUPPLIER_DASHBOARD_PATH = '/supplier-dashboard';
const DESIGNER_DASHBOARD_PATH = '/designer-dashboard';

/** Auth 页 Tab 切换时的内存覆盖（同 URL `/` 上区分 designer/supplier） */
let portalOverride: AppPortal | null = null;

export function setPortalOverride(portal: AppPortal | null): void {
  portalOverride = portal;
}

export function getPortalOverride(): AppPortal | null {
  return portalOverride;
}

export function isAdminHost(hostname = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
  const host = hostname.toLowerCase();
  if (!host) return false;
  // 精确：admin.localhost / admin.xxx.com / matterinsightadmin.vercel.app
  if (host === 'admin.localhost' || host.startsWith('admin.')) return true;
  if (host.includes('admin')) return true;
  return false;
}

export function isAdminPath(pathname = typeof window !== 'undefined' ? window.location.pathname : '/'): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return (
    path === ADMIN_PORTAL_PATH ||
    path === ADMIN_DASHBOARD_PATH ||
    path.startsWith('/admin/')
  );
}

/**
 * 根据当前入口解析 portal。
 * Auth Tab 可通过 setPortalOverride 覆盖（仅 designer|supplier）。
 */
export function getAppPortal(pathname?: string): AppPortal {
  if (typeof window === 'undefined') return 'designer';

  if (isAdminHost() || isAdminPath(pathname ?? window.location.pathname)) {
    return 'admin';
  }

  if (portalOverride === 'designer' || portalOverride === 'supplier') {
    return portalOverride;
  }

  const path = (pathname ?? window.location.pathname).toLowerCase().replace(/\/+$/, '') || '/';
  if (path === SUPPLIER_DASHBOARD_PATH || path.endsWith(SUPPLIER_DASHBOARD_PATH)) {
    return 'supplier';
  }
  if (path === DESIGNER_DASHBOARD_PATH || path.endsWith(DESIGNER_DASHBOARD_PATH)) {
    return 'designer';
  }

  return 'designer';
}

export function authStorageKeyFor(portal: AppPortal = getAppPortal()): string {
  return AUTH_STORAGE_KEYS[portal];
}

/** UI UserRole → Auth portal（登录/注册时写入对应 storageKey） */
export function portalFromUserRole(role: 'DESIGNER' | 'SUPPLIER' | 'ADMIN'): AppPortal {
  if (role === 'ADMIN') return 'admin';
  if (role === 'SUPPLIER') return 'supplier';
  return 'designer';
}
