import type { User, UserRole } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export interface ProfileRow {
  id: string;
  email: string;
  role: UserRole;
  name: string | null;
  company: string | null;
  points: number;
  status: 'pending' | 'approved' | 'rejected';
  is_verified: boolean;
  registered_phone: string | null;
  verification_doc_url: string | null;
}

const DEFAULT_COMPANY: Record<UserRole, string> = {
  DESIGNER: 'Creative Design Studio',
  SUPPLIER: 'Premium Materials Co.',
  ADMIN: '物见 | Matter Insight Official',
};

/** 读取当前用户资料（RLS 保证只能读自己的行，管理员策略另行配置） */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[profileService] fetchProfile:', error.message);
    return null;
  }
  return data as ProfileRow | null;
}

/** 注册后写入 profiles 行；返回是否为前 500 名设计师（用于欢迎积分） */
export async function upsertProfileOnSignup(
  userId: string,
  email: string,
  role: UserRole
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  let isFirst500 = false;
  if (role === 'DESIGNER') {
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'DESIGNER');
    isFirst500 = (count ?? 0) < 500;
  }

  const status = role === 'SUPPLIER' ? 'pending' : 'approved';
  const isVerified = role !== 'SUPPLIER';
  const points = role === 'DESIGNER' && isFirst500 ? 1000 : role === 'ADMIN' ? 999999 : 0;

  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      email,
      role,
      name: email.split('@')[0],
      company: DEFAULT_COMPANY[role],
      points,
      status,
      is_verified: isVerified,
    },
    { onConflict: 'id' }
  );

  if (error) console.error('[profileService] upsertProfileOnSignup:', error.message);
  return isFirst500;
}

/** 更新供应商认证信息 */
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
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  return !error;
}

/** 管理员批准供应商 */
export async function approveSupplier(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabase()
    .from('profiles')
    .update({
      status: 'approved',
      is_verified: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .eq('role', 'SUPPLIER');

  return !error;
}

/** 将 profiles 行映射为运营后台「供应商认证」列表项 */
export function profileRowToVerificationUser(row: ProfileRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? row.email.split('@')[0],
    role: 'SUPPLIER',
    company: row.company ?? undefined,
    points: row.points,
    isVerified: row.is_verified,
    accountStatus: row.status,
    registeredPhone: row.registered_phone ?? undefined,
    verificationDoc: row.verification_doc_url ?? undefined,
  };
}

/** 获取待审核供应商列表（仅 ADMIN 角色 RLS 策略允许时可用） */
export async function fetchPendingSuppliers(): Promise<ProfileRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('role', 'SUPPLIER')
    .eq('status', 'pending')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[profileService] fetchPendingSuppliers:', error.message);
    return [];
  }
  return (data ?? []) as ProfileRow[];
}

/** 管理员拉取待认证供应商（Supabase 为唯一数据源，避免各端 localStorage 不一致） */
export async function fetchVerificationRequestsForAdmin(): Promise<User[]> {
  const rows = await fetchPendingSuppliers();
  return rows.map(profileRowToVerificationUser);
}
