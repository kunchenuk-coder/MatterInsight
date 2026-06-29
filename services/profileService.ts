import type { User, UserRole, DbRole } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export type { DbRole };

export interface ProfileRow {
  id: string;
  email: string;
  role: DbRole | string;
  username?: string | null;
  avatar?: string | null;
  bio?: string | null;
  company?: string | null;
  registered_phone?: string | null;
  verification_doc_url?: string | null;
  status?: string | null;
  is_verified?: boolean | null;
}

export type DesignerProfileUpdate = {
  avatar?: string | null;
  username?: string;
  company?: string | null;
  bio?: string | null;
};

const PROFILE_COLUMNS =
  'id, email, role, username, avatar, bio, company, registered_phone, verification_doc_url, status, is_verified';

export function userRoleToDbRole(role: UserRole): DbRole {
  return role.toLowerCase() as DbRole;
}

/** 将数据库 / API 返回的 role 规范为小写英文：designer | supplier | admin */
export function normalizeDbRole(role: string | null | undefined): DbRole | null {
  const normalized = (role ?? '').toLowerCase().trim();
  if (normalized === 'designer') return 'designer';
  if (normalized === 'supplier') return 'supplier';
  if (normalized === 'admin') return 'admin';
  return null;
}

export function dbRoleToUserRole(role: string): UserRole {
  const dbRole = normalizeDbRole(role);
  if (dbRole === 'designer') return 'DESIGNER';
  if (dbRole === 'supplier') return 'SUPPLIER';
  if (dbRole === 'admin') return 'ADMIN';
  throw new Error(`未知角色: ${role}`);
}

/** 按 auth uid 读取 profiles（id = auth.users.id） */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await getSupabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[profileService] fetchProfile:', error.message);
    return null;
  }
  return data as ProfileRow | null;
}

/** 按邮箱查询 profiles（用于注册重复提示；需 RLS 允许或已通过 Auth 验证） */
export async function fetchProfileByEmail(email: string): Promise<ProfileRow | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await getSupabase()
    .from('profiles')
    .select('id, email, role')
    .eq('email', email.trim())
    .maybeSingle();

  if (error) {
    console.error('[profileService] fetchProfileByEmail:', error.message);
    return null;
  }
  return data as ProfileRow | null;
}

/**
 * 注册成功后写入身份行。
 *
 * 使用 upsert(onConflict: id)：若数据库触发器 handle_new_user 已自动插入
 * 一条默认 designer 行，这里用用户实际选择的 role 覆盖它，确保身份正确。
 * 该行 id = 当前刚注册的 auth.uid，RLS 的 insert/update own 策略均允许。
 */
export async function insertProfileOnSignup(
  userId: string,
  email: string,
  role: UserRole
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: '服务未配置' };
  }

  const { error } = await getSupabase()
    .from('profiles')
    .upsert(
      {
        id: userId,
        email,
        role: userRoleToDbRole(role),
        username: email.split('@')[0] || 'user',
      },
      { onConflict: 'id' }
    );

  if (!error) return { ok: true };

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
  const dbRole = normalizeDbRole(row.role) ?? 'supplier';
  const status = (row.status as User['accountStatus']) ?? 'pending';
  return {
    id: row.id,
    email: row.email,
    name: row.email.split('@')[0],
    role: 'SUPPLIER',
    dbRole,
    points: 0,
    isVerified: row.is_verified === true,
    accountStatus: status,
    registeredPhone: row.registered_phone ?? undefined,
    verificationDoc: row.verification_doc_url ?? undefined,
  };
}

export async function fetchPendingSuppliers(): Promise<ProfileRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('role', 'supplier')
    .order('email', { ascending: true });

  if (error) {
    console.error('[profileService] fetchPendingSuppliers:', error.message);
    return [];
  }
  return (data ?? []) as ProfileRow[];
}

/** 更新设计师公开资料（头像、用户名、公司名、简介） */
export async function updateDesignerProfile(
  userId: string,
  patch: DesignerProfileUpdate
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured() || !userId) {
    return { ok: false, error: '服务未配置' };
  }

  if (patch.bio && patch.bio.length > 100) {
    return { ok: false, error: '简介不能超过 100 字' };
  }

  const row: Record<string, unknown> = {};
  if (patch.avatar !== undefined) row.avatar = patch.avatar;
  if (patch.username !== undefined) row.username = patch.username.trim();
  if (patch.company !== undefined) row.company = patch.company;
  if (patch.bio !== undefined) row.bio = patch.bio;

  if (Object.keys(row).length === 0) return { ok: true };

  const { error } = await getSupabase()
    .from('profiles')
    .update(row)
    .eq('id', userId);

  if (error) {
    console.error('[profileService] updateDesignerProfile:', error.message);
    return { ok: false, error: '保存失败，请稍后重试' };
  }
  return { ok: true };
}

export async function fetchVerificationRequestsForAdmin(): Promise<User[]> {
  const rows = await fetchPendingSuppliers();
  return rows.map(profileRowToVerificationUser);
}
