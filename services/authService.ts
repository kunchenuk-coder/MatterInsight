import type { User, UserRole } from '../types';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';
import { getSupabase, supabase, isSupabaseConfigured } from './supabaseClient';
import { getPasswordResetRedirectUrl, isPasswordRecoveryFromUrl, isPasswordRecoveryMode, isResetPasswordRoute, lockPasswordRecoveryMode } from '../utils/authRoutes';
import {
  dbRoleToUserRole,
  fetchProfile,
  insertProfileOnSignup,
  type ProfileRow,
} from './profileService';

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

const LOGIN_FAILED_MSG = '邮箱或密码错误';

const PORTAL_LABEL: Record<UserRole, string> = {
  DESIGNER: '设计师',
  SUPPLIER: '材料商',
  ADMIN: '管理端',
};

function mapSignUpError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('unique')
  ) {
    return '该邮箱已被注册';
  }
  if (lower.includes('password')) {
    return '密码不符合要求，请使用至少 6 位字符';
  }
  return message;
}

/** 选项卡与数据库角色不一致时的提示 */
export function roleMismatchMessage(actualRole: UserRole): string {
  return `您的账号角色不符，请切换至${PORTAL_LABEL[actualRole]}入口登录！`;
}

export function isRoleMismatchError(message: string): boolean {
  return message.includes('账号角色不符');
}

function mapProfileToUser(
  profile: ProfileRow,
  extras?: { showWelcomeBonus?: boolean }
): User {
  const role = dbRoleToUserRole(profile.role);

  return {
    id: profile.id,
    email: profile.email,
    role,
    name: profile.email.split('@')[0] || '用户',
    points: role === 'DESIGNER' ? 1000 : role === 'ADMIN' ? 999999 : 0,
    isVerified: role !== 'SUPPLIER',
    accountStatus: role === 'SUPPLIER' ? 'approved' : undefined,
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

/** 注册：一邮箱一身份，角色写入 profiles.role（小写） */
export async function signUp(
  email: string,
  password: string,
  role: UserRole
): Promise<AuthResult> {
  if (role === 'ADMIN') {
    return { ok: false, error: '管理员账号请联系平台开通' };
  }

  const client = getSupabase();
  const { data, error } = await client.auth.signUp({ email, password });

  if (error) return { ok: false, error: mapSignUpError(error.message) };
  if (!data.user) return { ok: false, error: '注册失败，请重试' };
  if (!data.session) {
    return { ok: false, error: '注册成功，请查收邮箱验证链接后再登录' };
  }

  const profileResult = await insertProfileOnSignup(data.user.id, email, role);
  if (profileResult.ok === false) {
    await client.auth.signOut();
    return { ok: false, error: profileResult.error };
  }

  const profile = await requireProfile(data.user);
  if (!profile) {
    await client.auth.signOut();
    return { ok: false, error: '注册失败，请稍后重试' };
  }

  const user = mapProfileToUser(profile, {
    showWelcomeBonus: role === 'DESIGNER',
  });

  return { ok: true, user };
}

/**
 * 登录：Auth 通过后必须校验 profiles.role 与当前选项卡一致。
 */
export async function signIn(
  email: string,
  password: string,
  expectedRole: UserRole
): Promise<AuthResult> {
  const client = getSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return { ok: false, error: LOGIN_FAILED_MSG };
  }

  const profile = await requireProfile(data.user);
  if (!profile) {
    await client.auth.signOut();
    return { ok: false, error: '账号资料异常，请联系客服' };
  }

  let actualRole: UserRole;
  try {
    actualRole = dbRoleToUserRole(profile.role);
  } catch {
    await client.auth.signOut();
    return { ok: false, error: '账号角色数据异常，请联系客服' };
  }

  if (actualRole !== expectedRole) {
    await client.auth.signOut();
    return { ok: false, error: roleMismatchMessage(actualRole) };
  }

  return { ok: true, user: mapProfileToUser(profile) };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

/** 刷新页面时按 profiles 真实角色恢复（recovery 模式下一律不恢复进主页） */
export async function restoreSession(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  if (isPasswordRecoveryMode()) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) return null;

  const profile = await requireProfile(data.session.user);
  if (!profile) {
    await signOut();
    return null;
  }

  return mapProfileToUser(profile);
}

export function onAuthStateChange(
  callback: (user: User | null) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {};

  const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      lockPasswordRecoveryMode(true);
      callback(null);
      return;
    }

    if (isPasswordRecoveryMode()) {
      callback(null);
      return;
    }

    if (event === 'SIGNED_OUT' || !session?.user) {
      callback(null);
      return;
    }

    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      return;
    }

    const profile = await requireProfile(session.user);
    if (!profile) {
      callback(null);
      return;
    }

    callback(mapProfileToUser(profile));
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
