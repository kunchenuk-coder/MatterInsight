import type { SupplierProfile } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { resolveProfileAvatarUrl } from './assetReadUrlService';

type ProfileRow = {
  id: string;
  username: string | null;
  avatar: string | null;
  bio: string | null;
  company: string | null;
  role: string;
};

/**
 * 材料商公开主页：头像、名称、简介。
 * @param id auth.users.id（材料商 user id）
 */
export async function getSupplierProfile(id: string): Promise<SupplierProfile | null> {
  if (!isSupabaseConfigured() || !id) return null;

  const { data: profile, error: profileError } = await getSupabase()
    .from('profiles')
    .select('id, username, avatar, bio, company, role')
    .eq('id', id)
    .maybeSingle();

  if (profileError) {
    console.error('[supplierProfileService] getSupplierProfile:', profileError.message);
    return null;
  }
  if (!profile) return null;

  const row = profile as ProfileRow;
  if ((row.role ?? '').toLowerCase() !== 'supplier') return null;

  const avatar = await resolveProfileAvatarUrl(row.avatar);

  return {
    id: row.id,
    avatar,
    username: row.username?.trim() || row.id.slice(0, 8),
    company: row.company ?? null,
    bio: row.bio ?? null,
  };
}
