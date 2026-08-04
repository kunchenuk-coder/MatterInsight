import type { User, UserRole } from '../types';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import {
  getPasswordResetRedirectUrl,
  isPasswordRecoveryFromUrl,
  isPasswordRecoveryMode,
  isResetPasswordRoute,
  lockPasswordRecoveryMode,
} from '../utils/authRoutes';
import { getAppPortal, portalFromUserRole, setPortalOverride, type AppPortal } from '../utils/appPortal';
import {
  dbRoleToUserRole,
  fetchProfile,
  insertProfileOnSignup,
  normalizeDbRole,
  userRoleToDbRole,
  type ProfileRow,
} from './profileService';
import { resolveUserDisplayName } from '../utils/profileDisplayName';
import {
  clearLocalDeviceSession,
  ensureDeviceSessionOnRestore,
  registerDeviceSession,
  removeDeviceSession,
} from './deviceSessionService';

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

const LOGIN_FAILED_MSG = '邮箱或密码错误';

const PORTAL_LABEL: Record<UserRole, string> = {
  DESIGNER: '设计师',
  SUPPLIER: '材料商',
  ADMIN: '管理端',
};

function isDuplicateEmailError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('unique') ||
    lower.includes('duplicate')
  );
}

/** 该邮箱已绑定某一身份时的统一提示（登录错入口 / 注册重复） */
export function registeredRoleMessage(actualRole: UserRole): string {
  return `该邮箱已被注册为${PORTAL_LABEL[actualRole]}，请选用其他邮箱。`;
}

/** @deprecated 使用 registeredRoleMessage */
export function roleMismatchMessage(actualRole: UserRole): string {
  return registeredRoleMessage(actualRole);
}

export function isRegisteredRoleError(message: string): boolean {
  return message.includes('已被注册为');
}

export function isRoleMismatchError(message: string): boolean {
  return isRegisteredRoleError(message);
}

/**
 * 邮箱已存在时，用临时 designer portal 试登读取 profiles.role。
 * 仅清除 designer portal 的试登 session，不影响 admin/supplier 隔离会话。
 */
async function lookupExistingRoleByCredentials(
  email: string,
  password: string
): Promise<UserRole | null> {
  const client = getSupabaseForPortal('designer');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;

  const profile = await fetchProfile(data.user.id);
  await client.auth.signOut();
  if (!profile) return null;

  const dbRole = normalizeDbRole(profile.role);
  if (!dbRole) return null;
  return dbRoleToUserRole(dbRole);
}

function mapProfileToUser(
  profile: ProfileRow,
  extras?: { showWelcomeBonus?: boolean }
): User {
  const dbRole = normalizeDbRole(profile.role);
  if (!dbRole) {
    throw new Error(`无效 profiles.role: ${profile.role}`);
  }
  const role = dbRoleToUserRole(dbRole);
  const isSupplier = role === 'SUPPLIER';
  const supplierStatus =
    (profile.status as User['accountStatus']) ?? 'approved';

  return {
    id: profile.id,
    email: profile.email,
    role,
    dbRole,
    name: resolveUserDisplayName({ company: profile.company, email: profile.email }),
    company: profile.company?.trim() || undefined,
    points: role === 'DESIGNER' ? 1000 : role === 'ADMIN' ? 999999 : 0,
    isVerified: isSupplier ? profile.is_verified === true : true,
    accountStatus: isSupplier ? supplierStatus : undefined,
    registeredPhone: profile.registered_phone ?? undefined,
    verificationDoc: profile.verification_doc_url ?? undefined,
    avatar: profile.avatar ?? null,
    transactions: [],
    collections: [],
    ...(extras?.showWelcomeBonus ? { showWelcomeBonus: true } : {}),
  } as User & { showWelcomeBonus?: boolean };
}

async function requireProfile(
  authUser: Pick<SupabaseAuthUser, 'id'>
): Promise<ProfileRow | null> {
  return fetchProfile(authUser.id);
}

/** 注册失败时仅清除当前 portal 刚写入的 session（不触碰其他端） */
async function discardPortalSession(portal: AppPortal): Promise<void> {
  try {
    await getSupabaseForPortal(portal).auth.signOut();
  } catch {
    /* ignore */
  }
}

/** 注册：一邮箱一身份，角色写入 profiles.role（小写） */
export async function signUp(
  email: string,
  password: string,
  role: UserRole
): Promise<AuthResult> {
  if (role === 'ADMIN') {
    return { ok: false, error: '管理员账号请联系平台开通' };
  }

  const portal = portalFromUserRole(role);
  setPortalOverride(portal);
  const client = getSupabaseForPortal(portal);
  const dbRole = userRoleToDbRole(role);

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { role: dbRole } },
  });

  if (error) {
    if (isDuplicateEmailError(error.message)) {
      const existingRole = await lookupExistingRoleByCredentials(email, password);
      if (existingRole) {
        return { ok: false, error: registeredRoleMessage(existingRole) };
      }
      return { ok: false, error: '该邮箱已被注册，请选用其他邮箱' };
    }
    const lower = error.message.toLowerCase();
    if (lower.includes('password')) {
      return { ok: false, error: '密码不符合要求，请使用至少 6 位字符' };
    }
    return { ok: false, error: error.message };
  }
  if (!data.user) return { ok: false, error: '注册失败，请重试' };
  if (!data.session) {
    return { ok: false, error: '注册成功，请查收邮箱验证链接后再登录' };
  }

  const profileResult = await insertProfileOnSignup(data.user.id, email, role);
  if (profileResult.ok === false) {
    await discardPortalSession(portal);
    return { ok: false, error: profileResult.error };
  }

  const profile = await requireProfile(data.user);
  if (!profile) {
    // 资料暂不可读：保留 session，由 UI 提示，禁止误杀其他端
    console.warn('[authService] signUp profile missing; keeping portal session');
    return { ok: false, error: '注册成功但资料加载失败，请刷新后重试' };
  }

  const user = mapProfileToUser(profile, {
    showWelcomeBonus: role === 'DESIGNER',
  });

  const sessionOk = await registerDeviceSession(
    data.user.id,
    data.session?.access_token,
    portal
  );
  if (!sessionOk) {
    // 设备指纹暂时失败：不清除 Auth session
    console.warn('[authService] signUp device session register failed; keeping auth session');
  }

  return { ok: true, user };
}

/**
 * 登录：写入 expectedRole 对应 portal 的 storageKey（与其他端隔离）。
 */
export async function signIn(
  email: string,
  password: string,
  expectedRole: UserRole
): Promise<AuthResult> {
  const portal = portalFromUserRole(expectedRole);
  setPortalOverride(portal === 'admin' ? null : portal);
  const client = getSupabaseForPortal(portal);

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return { ok: false, error: LOGIN_FAILED_MSG };
  }

  const profile = await requireProfile(data.user);
  if (!profile) {
    console.warn('[authService] signIn profile missing; keeping portal session');
    return { ok: false, error: '账号资料加载失败，请稍后重试（未清除登录会话）' };
  }

  const role = normalizeDbRole(profile.role);
  if (!role) {
    await discardPortalSession(portal);
    return { ok: false, error: '账号角色数据异常，请联系客服' };
  }

  const actualRole = dbRoleToUserRole(role);
  if (role !== userRoleToDbRole(expectedRole)) {
    // 错入口：仅丢掉本 portal 刚写入的错误 session，不影响其他端已登录态
    await discardPortalSession(portal);
    return { ok: false, error: registeredRoleMessage(actualRole) };
  }

  const sessionOk = await registerDeviceSession(
    data.user.id,
    data.session.access_token,
    portal
  );
  if (!sessionOk) {
    console.warn('[authService] signIn device session register failed; keeping auth session');
  }

  return { ok: true, user: mapProfileToUser(profile) };
}

/** 仅退出当前 portal 的 Auth session（主动退出） */
export async function signOut(options?: { removeDeviceRecord?: boolean }): Promise<void> {
  const portal = getAppPortal();
  const client = getSupabaseForPortal(portal);
  const { data } = await client.auth.getSession();
  const userId = data.session?.user?.id;
  const removeDevice = options?.removeDeviceRecord !== false;
  if (userId && removeDevice) {
    await removeDeviceSession(userId, portal);
  }
  clearLocalDeviceSession(userId ?? undefined, portal);
  await client.auth.signOut();
}

/**
 * 刷新恢复：只读当前入口 portal 的 session。
 * profile / device 暂时失败时不 signOut。
 */
export async function restoreSession(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  if (isPasswordRecoveryMode()) return null;

  const portal = getAppPortal();
  const client = getSupabaseForPortal(portal);
  const { data, error } = await client.auth.getSession();

  // refresh token 明确失效 → 允许清除本 portal session
  if (error && /refresh token|invalid.*token|session.*expired/i.test(error.message ?? '')) {
    await discardPortalSession(portal);
    return null;
  }
  if (error || !data.session?.user) return null;

  const profile = await requireProfile(data.session.user);
  if (!profile) {
    console.warn('[authService] restoreSession profile missing; keeping session');
    return null;
  }

  const sessionOk = await ensureDeviceSessionOnRestore(
    data.session.user.id,
    data.session.access_token,
    portal
  );
  if (!sessionOk) {
    console.warn('[authService] restoreSession device mismatch (temporary); keeping auth session');
  }

  try {
    const user = mapProfileToUser(profile);
    // 入口与角色不符：不清除 session，交给路由层 redirect / unauthorized
    if (portalFromUserRole(user.role) !== portal && portal === 'admin') {
      console.warn('[authService] non-admin session on admin portal; not signing out');
      return null;
    }
    if (portal === 'admin' && user.dbRole !== 'admin') {
      return null;
    }
    if (portal !== 'admin' && user.dbRole === 'admin') {
      return null;
    }
    return user;
  } catch (err) {
    console.warn('[authService] restoreSession mapProfile failed:', err);
    return null;
  }
}

export function onAuthStateChange(
  callback: (user: User | null) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {};

  const portal = getAppPortal();
  const client = getSupabaseForPortal(portal);

  // 只监听当前 portal；SIGNED_OUT 不波及其他 portal 的 storageKey
  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      lockPasswordRecoveryMode(true);
      callback(null);
      return;
    }

    if (isPasswordRecoveryMode()) {
      callback(null);
      return;
    }

    if (event === 'SIGNED_OUT') {
      callback(null);
      return;
    }

    // TOKEN_REFRESHED 失败时 supabase-js 可能随后发 SIGNED_OUT；此处不主动清 session
    if (event === 'TOKEN_REFRESHED' && !session) {
      callback(null);
    }
  });

  return () => data.subscription.unsubscribe();
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** 发送密码重置邮件 */
export async function requestPasswordReset(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: '请输入邮箱地址' };
  }

  const { error } = await getSupabase().auth.resetPasswordForEmail(trimmed, {
    redirectTo: getPasswordResetRedirectUrl(),
  });

  if (error) {
    console.error('[authService] requestPasswordReset:', error.message);
    return { ok: false, error: '发送失败，请检查邮箱地址后重试' };
  }

  return { ok: true };
}

/** 重置密码页：写入新密码 */
export async function updatePassword(
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await getSupabase().auth.updateUser({ password: newPassword });

  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('password') || lower.includes('weak')) {
      return { ok: false, error: '密码不符合要求，请使用至少 6 位字符' };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * 等待邮件链接带来的 recovery session 就绪（hash 含 type=recovery）。
 */
export async function waitForRecoverySession(timeoutMs = 15_000): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  lockPasswordRecoveryMode(true);
  const client = getSupabase();

  const hasRecoverySession = async (): Promise<boolean> => {
    const { data } = await client.auth.getSession();
    return Boolean(data.session);
  };

  if (isPasswordRecoveryFromUrl() && (await hasRecoverySession())) return true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      subscription.unsubscribe();
      if (value) lockPasswordRecoveryMode(true);
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(false), timeoutMs);

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!session) return;
      if (event === 'PASSWORD_RECOVERY') {
        finish(true);
        return;
      }
      if (
        event === 'SIGNED_IN' &&
        (isPasswordRecoveryFromUrl() || isResetPasswordRoute() || isPasswordRecoveryMode())
      ) {
        finish(true);
      }
    });
  });
}
