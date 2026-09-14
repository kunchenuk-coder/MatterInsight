import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import { resolveDesignerDisplayName } from '../utils/profileDisplayName';
import { pickLocale, type LocalizedText } from '../utils/localizedText';

export type ProjectAdoptionStatus = 'pending_review' | 'approved' | 'rejected';

export interface ProjectAdoptionRow {
  id: string;
  designer_id: string;
  material_id: string;
  project_images: string[];
  status: ProjectAdoptionStatus;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminProjectAdoptionRow extends ProjectAdoptionRow {
  designer_name: string;
  designer_email: string | null;
  material_name: string;
}

const COLUMNS =
  'id, designer_id, material_id, project_images, status, reject_reason, reviewed_by, reviewed_at, created_at, updated_at';

const ADMIN_SELECT = `
  ${COLUMNS},
  profiles:designer_id ( username, company, email ),
  materials:material_id ( data )
`;

function mapRow(row: Record<string, unknown>): ProjectAdoptionRow {
  const images = Array.isArray(row.project_images)
    ? (row.project_images as unknown[]).filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    : [];
  return {
    id: String(row.id),
    designer_id: String(row.designer_id),
    material_id: String(row.material_id),
    project_images: images,
    status: row.status as ProjectAdoptionStatus,
    reject_reason: (row.reject_reason as string | null) ?? null,
    reviewed_by: (row.reviewed_by as string | null) ?? null,
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function materialNameFromData(data: unknown): string {
  if (!data || typeof data !== 'object') return '（未命名材料）';
  const name = (data as { name?: string | LocalizedText }).name;
  if (!name) return '（未命名材料）';
  if (typeof name === 'string') return name.trim() || '（未命名材料）';
  return pickLocale(name).trim() || '（未命名材料）';
}

function mapAdminRow(row: Record<string, unknown>): AdminProjectAdoptionRow {
  const base = mapRow(row);
  const profile = row.profiles as {
    username?: string | null;
    company?: string | null;
    email?: string | null;
  } | null;
  const material = row.materials as { data?: unknown } | null;
  return {
    ...base,
    designer_name: resolveDesignerDisplayName({
      company: profile?.company,
      username: profile?.username,
      email: profile?.email,
    }),
    designer_email: profile?.email ?? null,
    material_name: materialNameFromData(material?.data),
  };
}

/** 当前设计师对本材料的记录：优先 pending_review，否则取最近一条 */
export async function fetchMyProjectAdoptionForMaterial(
  materialId: string,
  designerId: string
): Promise<ProjectAdoptionRow | null> {
  if (!isSupabaseConfigured() || !materialId || !designerId) return null;

  const client = getSupabase();

  const { data: pending, error: pendingErr } = await client
    .from('material_project_adoptions')
    .select(COLUMNS)
    .eq('material_id', materialId)
    .eq('designer_id', designerId)
    .eq('status', 'pending_review')
    .maybeSingle();

  if (pendingErr) {
    console.error('[projectAdoptionService] fetch pending:', pendingErr.message);
  } else if (pending) {
    return mapRow(pending as Record<string, unknown>);
  }

  const { data: latest, error: latestErr } = await client
    .from('material_project_adoptions')
    .select(COLUMNS)
    .eq('material_id', materialId)
    .eq('designer_id', designerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    console.error('[projectAdoptionService] fetch latest:', latestErr.message);
    return null;
  }
  return latest ? mapRow(latest as Record<string, unknown>) : null;
}

/** 材料详情公开展示：仅 approved */
export async function fetchApprovedProjectAdoptions(
  materialId: string
): Promise<ProjectAdoptionRow[]> {
  if (!isSupabaseConfigured() || !materialId) return [];

  const { data, error } = await getSupabase()
    .from('material_project_adoptions')
    .select(COLUMNS)
    .eq('material_id', materialId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[projectAdoptionService] fetchApproved:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function submitProjectAdoption(
  materialId: string,
  designerId: string,
  objectKeys: string[]
): Promise<{ ok: true; row: ProjectAdoptionRow } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: '服务未配置' };
  }

  const keys = objectKeys.map((k) => k.trim()).filter(Boolean);
  if (keys.length < 1 || keys.length > 6) {
    return { ok: false, error: '请上传 1–6 张项目实拍图' };
  }
  if (!materialId || !designerId) {
    return { ok: false, error: '参数无效' };
  }

  const { data, error } = await getSupabase()
    .from('material_project_adoptions')
    .insert({
      designer_id: designerId,
      material_id: materialId,
      project_images: keys,
      status: 'pending_review',
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error('[projectAdoptionService] submit:', error.message);
    if (error.code === '23505' || /unique|duplicate/i.test(error.message)) {
      return { ok: false, error: '已有审核中的提交' };
    }
    return { ok: false, error: '提交失败，请稍后重试' };
  }

  return { ok: true, row: mapRow(data as Record<string, unknown>) };
}

/** Admin：待审项目案例（created_at desc） */
export async function fetchPendingProjectAdoptionsForAdmin(): Promise<AdminProjectAdoptionRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabaseForPortal('admin')
    .from('material_project_adoptions')
    .select(ADMIN_SELECT)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[projectAdoptionService] fetchPendingAdmin:', error.message);
    return [];
  }
  return (data ?? []).map((row) => mapAdminRow(row as Record<string, unknown>));
}

export async function approveProjectAdoption(
  adoptionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured() || !adoptionId) {
    return { ok: false, error: '参数无效' };
  }

  const { error } = await getSupabaseForPortal('admin').rpc(
    'approve_material_project_adoption',
    { p_adoption_id: adoptionId }
  );

  if (error) {
    console.error('[projectAdoptionService] approve:', error.message);
    return { ok: false, error: error.message || '通过失败' };
  }
  return { ok: true };
}

export async function rejectProjectAdoption(
  adoptionId: string,
  reason?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured() || !adoptionId) {
    return { ok: false, error: '参数无效' };
  }

  const { error } = await getSupabaseForPortal('admin').rpc(
    'reject_material_project_adoption',
    {
      p_adoption_id: adoptionId,
      p_reason: reason?.trim() || null,
    }
  );

  if (error) {
    console.error('[projectAdoptionService] reject:', error.message);
    return { ok: false, error: error.message || '拒绝失败' };
  }
  return { ok: true };
}
