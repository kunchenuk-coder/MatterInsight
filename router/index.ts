/**
 * 角色 → 仪表板路由（路由守卫）
 *
 * 身份1 设计师   → /designer-dashboard  （设计师工作台）
 * 身份2 材料商   → /supplier-dashboard  （材料商仓库）
 * 身份3 管理端   → /admin-dashboard     （后台总控台）
 */

import type { DbRole } from '../types';
import { normalizeDbRole } from '../services/profileService';
import { isAdminPortal } from '../utils/authRoutes';

/** 独立登录页（禁止再用 `/` 兼作登录落地，避免默认 designer portal 静默恢复） */
export const LOGIN_PATH = '/login';

export const DESIGNER_DASHBOARD_PATH = '/designer-dashboard';
export const SUPPLIER_DASHBOARD_PATH = '/supplier-dashboard';
export const ADMIN_DASHBOARD_PATH = '/admin-dashboard';
export const MY_PAGE_PATH = '/my-page';
export const SUPPLIER_TOPIC_NEW_PATH = '/supplier/topics/new';

export function getTopicPath(id: string): string {
  return `/topics/${encodeURIComponent(id)}`;
}

export function getSupplierTopicEditPath(articleId: string): string {
  return `/supplier/topics/${encodeURIComponent(articleId)}/edit`;
}

export function parseTopicId(pathname = window.location.pathname): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const match = normalized.match(/^\/topics\/([^/]+)$/i);
  return match ? decodeURIComponent(match[1]) : null;
}

export function parseSupplierTopicEditor(
  pathname = window.location.pathname
): { articleId: string | null } | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === SUPPLIER_TOPIC_NEW_PATH) return { articleId: null };
  const match = normalized.match(/^\/supplier\/topics\/([^/]+)\/edit$/i);
  if (!match) return null;
  return { articleId: decodeURIComponent(match[1]) };
}

const DASHBOARD_PATHS = [
  DESIGNER_DASHBOARD_PATH,
  SUPPLIER_DASHBOARD_PATH,
  ADMIN_DASHBOARD_PATH,
] as const;

export type AppPageRoute =
  | { type: 'dashboard' }
  | { type: 'my-page' }
  | { type: 'designer'; id: string }
  | { type: 'material'; id: string }
  | { type: 'topic'; id: string }
  | { type: 'supplier-topic-editor'; articleId: string | null }
  | { type: 'other' };

export function getMaterialPath(id: string, options?: { mode?: 'edit' }): string {
  const base = `/material/${encodeURIComponent(id)}`;
  if (options?.mode === 'edit') return `${base}?mode=edit`;
  return base;
}

export function parseMaterialEditMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('mode') === 'edit';
}

export function getMaterialPathWithSearch(pathname: string, search = window.location.search): string {
  return search ? `${pathname}${search}` : pathname;
}

export function parseMaterialId(pathname = window.location.pathname): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const match = normalized.match(/^\/material\/([^/]+)$/i);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getDesignerPublicPath(id: string): string {
  return `/designer/${id}`;
}

export function parseAppPageRoute(pathname = window.location.pathname): AppPageRoute {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (normalized === MY_PAGE_PATH) return { type: 'my-page' };
  const designerMatch = normalized.match(/\/designer\/([0-9a-f-]{36})$/i);
  if (designerMatch) return { type: 'designer', id: designerMatch[1] };
  const materialId = parseMaterialId(pathname);
  if (materialId) return { type: 'material', id: materialId };
  const topicId = parseTopicId(pathname);
  if (topicId) return { type: 'topic', id: topicId };
  const topicEditor = parseSupplierTopicEditor(pathname);
  if (topicEditor) return { type: 'supplier-topic-editor', articleId: topicEditor.articleId };
  if (isDashboardPath(normalized)) return { type: 'dashboard' };
  return { type: 'other' };
}

export function navigateTo(path: string, replace = false): void {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export type DashboardPath = (typeof DASHBOARD_PATHS)[number];

/** 根据数据库 role（小写）解析仪表板路径；无效角色返回 null */
export function getDashboardPathForRole(role: string | null | undefined): DashboardPath | null {
  const dbRole = normalizeDbRole(role);
  if (!dbRole) return null;

  switch (dbRole) {
    case 'designer':
      return DESIGNER_DASHBOARD_PATH;
    case 'supplier':
      return SUPPLIER_DASHBOARD_PATH;
    case 'admin':
      return ADMIN_DASHBOARD_PATH;
    default:
      return null;
  }
}

/** 登录成功后按数据库 role 跳转，禁止写死路径 */
export function redirectToRoleDashboard(
  role: string | null | undefined,
  replace = false
): DashboardPath | null {
  const path = getDashboardPathForRole(role);
  if (!path) {
    window.location.replace(LOGIN_PATH);
    return null;
  }

  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
  return path;
}

/**
 * 管理员入口（/admin 或 admin 子域）：仅 admin 可进入后台；非 admin 返回 null（由调用方 signOut）。
 * 普通入口（Designer/Supplier）：禁止 admin 会话自动跳到 /admin-dashboard。
 * 未登录落地为独立 /login，勿依赖 `/`（`/` 默认 portal=designer，易静默恢复）。
 */
export function redirectAfterAuth(
  dbRole: string | null | undefined,
  replace = false
): DashboardPath | null {
  const role = normalizeDbRole(dbRole);
  if (isAdminPortal()) {
    if (role !== 'admin') return null;
    return redirectToRoleDashboard('admin', replace);
  }
  // Public portal: admin must re-auth via /admin; do not hijack Designer/Supplier entry
  if (role === 'admin') return null;
  return redirectToRoleDashboard(role, replace);
}

export function isDashboardPath(pathname = window.location.pathname): boolean {
  const normalized = pathname.toLowerCase();
  return DASHBOARD_PATHS.some((p) => normalized === p || normalized.endsWith(p));
}

export function getRoleFromDashboardPath(pathname = window.location.pathname): DbRole | null {
  const normalized = pathname.toLowerCase();
  if (normalized === DESIGNER_DASHBOARD_PATH || normalized.endsWith(DESIGNER_DASHBOARD_PATH)) {
    return 'designer';
  }
  if (normalized === SUPPLIER_DASHBOARD_PATH || normalized.endsWith(SUPPLIER_DASHBOARD_PATH)) {
    return 'supplier';
  }
  if (normalized === ADMIN_DASHBOARD_PATH || normalized.endsWith(ADMIN_DASHBOARD_PATH)) {
    return 'admin';
  }
  return null;
}

export type GuardResult = 'ok' | 'redirected' | 'unauthorized';

/**
 * 路由守卫：role / path 不匹配时只 redirect，禁止 signOut（保护三端隔离 session）。
 * @returns true 允许停留；false 已 redirect（调用方勿再 signOut）
 */
export function guardDashboardRoute(userDbRole: string | null | undefined): boolean {
  const role = normalizeDbRole(userDbRole);
  if (!role) {
    // 角色未就绪：不登出，回到当前入口登录 UI
    const loginPath = isAdminPortal() ? '/admin' : LOGIN_PATH;
    if (window.location.pathname !== loginPath) {
      window.history.replaceState({}, '', loginPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return false;
  }

  const pageRoute = parseAppPageRoute();
  if (
    pageRoute.type === 'my-page' ||
    pageRoute.type === 'designer' ||
    pageRoute.type === 'material' ||
    pageRoute.type === 'topic'
  ) {
    return true;
  }
  if (pageRoute.type === 'supplier-topic-editor') {
    if (role !== 'supplier') {
      const correct = getDashboardPathForRole(role);
      if (correct) {
        window.history.replaceState({}, '', correct);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      return false;
    }
    return true;
  }

  const pathRole = getRoleFromDashboardPath();
  if (!pathRole) {
    return true;
  }

  if (pathRole !== role) {
    const correct = getDashboardPathForRole(role);
    if (correct) {
      window.history.replaceState({}, '', correct);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      window.history.replaceState({}, '', isAdminPortal() ? '/admin' : LOGIN_PATH);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return false;
  }

  return true;
}

/** 互踢 / 强制下线：硬跳独立登录页，替换历史，禁止静默回后台 */
export function kickToLogin(): void {
  window.location.replace(LOGIN_PATH);
}
