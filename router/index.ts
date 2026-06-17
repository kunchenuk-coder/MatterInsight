/**
 * 角色 → 仪表板路由（路由守卫）
 *
 * 身份1 设计师   → /designer-dashboard  （设计师工作台）
 * 身份2 材料商   → /supplier-dashboard  （材料商仓库）
 * 身份3 管理端   → /admin-dashboard     （后台总控台）
 */

import type { DbRole } from '../types';
import { normalizeDbRole } from '../services/profileService';

export const LOGIN_PATH = '/';

export const DESIGNER_DASHBOARD_PATH = '/designer-dashboard';
export const SUPPLIER_DASHBOARD_PATH = '/supplier-dashboard';
export const ADMIN_DASHBOARD_PATH = '/admin-dashboard';

const DASHBOARD_PATHS = [
  DESIGNER_DASHBOARD_PATH,
  SUPPLIER_DASHBOARD_PATH,
  ADMIN_DASHBOARD_PATH,
] as const;

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
    window.location.href = LOGIN_PATH;
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

/**
 * 路由守卫：当前路径与登录用户 role 不一致 → 退回登录页。
 * @returns true 允许停留；false 已重定向到登录页
 */
export function guardDashboardRoute(userDbRole: string | null | undefined): boolean {
  const role = normalizeDbRole(userDbRole);
  if (!role) {
    window.location.href = LOGIN_PATH;
    return false;
  }

  const pathRole = getRoleFromDashboardPath();
  if (!pathRole) {
    return true;
  }

  if (pathRole !== role) {
    window.location.href = LOGIN_PATH;
    return false;
  }

  return true;
}

export function kickToLogin(): void {
  window.location.href = LOGIN_PATH;
}
