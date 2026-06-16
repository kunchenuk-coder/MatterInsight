import type { User, UserRole } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

/** Supabase profiles.role 存储值（小写） */
export type DbRole = 'designer' | 'supplier' | 'admin';

export interface ProfileRow {
  id: string;
  email: string;
  role: DbRole | string;
}

export function userRoleToDbRole(role: UserRole): DbRole {
  return role.toLowerCase() as DbRole;
}

export function dbRoleToUserRole(role: string): UserRole {
  const normalized = role.toLowerCase();
  if (normalized === 'designer') return 'DESIGNER';
  if (normalized === 'supplier') return 'SUPPLIER';
  if (normalized === 'admin') return 'ADMIN';
  throw new Error(`未知角色: ${role}`);
}

/** 按 auth uid 读取 profiles（id = auth.users.id） */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await getSupabase()
    .from('profiles')
    .select('id, email, role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[profileService] fetchProfile:', error.message);
    return null;
  }
  return data as ProfileRow | null;
}

/** 注册成功后写入唯一身份行 */
export async function insertProfileOnSignup(
  userId: string,
  email: string,
  role: UserRole
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: '服务未配置' };
  }

  const { error } = await getSupabase().from('profiles').insert({
    id: userId,
    email,
    role: userRoleToDbRole(role),
  });

  if (!error) return { ok: true };

  const msg = error.message.toLowerCase();
  const duplicate =
    error.code === '23505' ||
    msg.includes('unique') ||
    msg.includes('duplicate') ||
    msg.includes('already exists');

  if (duplicate) {
    return { ok: false, error: '该邮箱已被注册' };
  }

  console.error('[profileService] insertProfileOnSignup:', error.message);
  return { ok: false, error: '注册失败，请稍后重试' };
}

/** 更新供应商认证信息（扩展字段未配置时静默跳过） */
export async function updateVerificationRequest(
  userId: string,
  phone: string,
  docUrl: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabase()
    .from('profiles')
    .update({
      registered_phone: phone,
      verification_doc_url: docUrl,
    })
    .eq('id', userId);

  return !error;
}

/** 管理员批准供应商 */
export async function approveSupplier(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabase()
    .from('profiles')
    .update({ status: 'approved', is_verified: true })
    .eq('id', userId)
    .eq('role', 'supplier');

  return !error;
}

export function profileRowToVerificationUser(row: ProfileRow): User {
  const role = dbRoleToUserRole(row.role);
  return {
    id: row.id,
    email: row.email,
    name: row.email.split('@')[0],
    role: 'SUPPLIER',
    points: 0,
    isVerified: false,
    accountStatus: 'pending',
  };
}

export async function fetchPendingSuppliers(): Promise<ProfileRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('profiles')
    .select('id, email, role')
    .eq('role', 'supplier')
    .order('email', { ascending: true });

  if (error) {
    console.error('[profileService] fetchPendingSuppliers:', error.message);
    return [];
  }
  return (data ?? []) as ProfileRow[];
}

export async function fetchVerificationRequestsForAdmin(): Promise<User[]> {
  const rows = await fetchPendingSuppliers();
  return rows.map(profileRowToVerificationUser);
}
