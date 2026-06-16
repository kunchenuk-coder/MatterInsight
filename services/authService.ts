import type { User, UserRole } from '../types';
import { getSupabase } from './supabaseClient';
import { fetchProfile, upsertProfileOnSignup } from './profileService';

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

const LOGIN_FAILED_MSG = '邮箱或密码错误';

function mapSignUpError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return '该邮箱已注册，请直接登录';
  }
  if (lower.includes('password')) {
    return '密码不符合要求，请使用至少 6 位字符';
  }
  return message;
}

function mapProfileToUser(
  profile: {
    id: string;
    email: string;
    role: UserRole;
    name: string | null;
    company: string | null;
    points: number;
    status: string;
    is_verified: boolean;
    registered_phone: string | null;
    verification_doc_url: string | null;
  },
  extras?: { showWelcomeBonus?: boolean }
): User {
  const accountStatus = profile.status as User['accountStatus'];
  const supplierApproved = profile.role !== 'SUPPLIER' || profile.status === 'approved';

  return {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    name: profile.name ?? profile.email.split('@')[0],
    company: profile.company ?? undefined,
    points: profile.points ?? 0,
    isVerified: profile.is_verified && supplierApproved,
    accountStatus: profile.role === 'SUPPLIER' ? accountStatus : undefined,
    registeredPhone: profile.registered_phone ?? undefined,
    verificationDoc: profile.verification_doc_url ?? undefined,
    transactions: [],
    collections: [],
    ...(extras?.showWelcomeBonus ? { showWelcomeBonus: true } : {}),
  } as User & { showWelcomeBonus?: boolean };
}

/** 注册新用户（须 Supabase 已配置） */
export async function signUp(
  email: string,
  password: string,
  role: UserRole
): Promise<AuthResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) return { ok: false, error: mapSignUpError(error.message) };
  if (!data.user) return { ok: false, error: '注册失败，请重试' };
  if (!data.session) {
    return { ok: false, error: '注册成功，请查收邮箱验证链接后再登录' };
  }

  const isFirst500 = await upsertProfileOnSignup(data.user.id, email, role);
  const profile = await fetchProfile(data.user.id);
  if (!profile) return { ok: false, error: '用户资料创建失败' };

  return {
    ok: true,
    user: mapProfileToUser(profile, {
      showWelcomeBonus: role === 'DESIGNER' && isFirst500,
    }),
  };
}

/**
 * 邮箱密码登录 — 唯一登录入口，直接调用 signInWithPassword。
 * 任何 error / 无 session / 无 user / 无 profile 一律失败，不进入应用。
 */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return { ok: false, error: LOGIN_FAILED_MSG };
  }

  const profile = await fetchProfile(data.user.id);
  if (!profile) {
    return { ok: false, error: LOGIN_FAILED_MSG };
  }

  return { ok: true, user: mapProfileToUser(profile) };
}

/** 退出登录 */
export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

/** 页面刷新时恢复 Session */
export async function restoreSession(): Promise<User | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) return null;

  const profile = await fetchProfile(data.session.user.id);
  if (!profile) return null;

  return mapProfileToUser(profile);
}

/** 监听 Auth 状态变化 */
export function onAuthStateChange(
  callback: (user: User | null) => void
): () => void {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      callback(null);
      return;
    }
    const profile = await fetchProfile(session.user.id);
    callback(profile ? mapProfileToUser(profile) : null);
  });

  return () => data.subscription.unsubscribe();
}

/** 获取当前 Session 的 access_token */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
