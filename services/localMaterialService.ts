import type { LocalTemporaryMaterial } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import {
  LOCAL_TEMP_DEFAULT_NAME,
  LOCAL_TEMP_DEFAULT_SPEC,
} from '../utils/localDesignerMaterials';

function rowToLocalMaterial(row: {
  id: string;
  user_id: string;
  name: string;
  spec: string;
  image_url: string;
  created_at: number;
  oss_object_key?: string | null;
  review_status?: string | null;
  model_3d_url?: string | null;
}): LocalTemporaryMaterial {
  return {
    id: row.id,
    designerId: row.user_id,
    name: row.name,
    spec: row.spec,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    isLocalStorageMaterial: true,
    isEditedByUser: true,
    ossObjectKey: row.oss_object_key ?? undefined,
    reviewStatus: (row.review_status as LocalTemporaryMaterial['reviewStatus']) ?? 'pending_review',
    model3dUrl: row.model_3d_url ?? undefined,
  };
}

/** 加载设计师本地材料（严格按 user_id 过滤） */
export async function fetchLocalMaterials(
  userId: string
): Promise<LocalTemporaryMaterial[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await getSupabase()
    .from('local_materials')
    .select('id, user_id, name, spec, image_url, created_at, oss_object_key, review_status, model_3d_url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[localMaterialService] fetch:', error.message);
    return [];
  }
  return (data ?? []).map(rowToLocalMaterial);
}

/** 插入一条本地材料（含 OSS 图片 URL） */
export async function insertLocalMaterial(
  userId: string,
  imageUrl: string,
  opts?: {
    name?: string;
    spec?: string;
    id?: string;
    ossObjectKey?: string;
    reviewStatus?: 'pending_review' | 'approved' | 'rejected';
    model3dUrl?: string;
  }
): Promise<LocalTemporaryMaterial | null> {
  if (!isSupabaseConfigured() || !userId) return null;

  const row = {
    id: opts?.id,
    user_id: userId,
    name: opts?.name ?? LOCAL_TEMP_DEFAULT_NAME,
    spec: opts?.spec ?? LOCAL_TEMP_DEFAULT_SPEC,
    image_url: imageUrl,
    created_at: Date.now(),
    oss_object_key: opts?.ossObjectKey ?? null,
    review_status: opts?.reviewStatus ?? 'pending_review',
    model_3d_url: opts?.model3dUrl ?? null,
  };

  const { data, error } = await getSupabase()
    .from('local_materials')
    .insert(row)
    .select('id, user_id, name, spec, image_url, created_at, oss_object_key, review_status, model_3d_url')
    .single();

  if (error) {
    console.error('[localMaterialService] insert:', error.message);
    return null;
  }
  return rowToLocalMaterial(data);
}

/** 更新本地材料 */
export async function updateLocalMaterial(
  userId: string,
  material: LocalTemporaryMaterial
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const { error } = await getSupabase()
    .from('local_materials')
    .update({
      name: material.name,
      spec: material.spec,
      image_url: material.imageUrl,
    })
    .eq('id', material.id)
    .eq('user_id', userId);

  return !error;
}

/** 删除本地材料 */
export async function deleteLocalMaterial(
  userId: string,
  materialId: string
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const { error } = await getSupabase()
    .from('local_materials')
    .delete()
    .eq('id', materialId)
    .eq('user_id', userId);

  return !error;
}

/** 全量同步（用于批量迁移） */
export async function syncLocalMaterials(
  userId: string,
  items: LocalTemporaryMaterial[]
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const supabase = getSupabase();
  await supabase.from('local_materials').delete().eq('user_id', userId);

  if (items.length === 0) return true;

  const rows = items.map((m) => ({
    id: m.id,
    user_id: userId,
    name: m.name,
    spec: m.spec,
    image_url: m.imageUrl,
    created_at: m.createdAt,
  }));

  const { error } = await supabase.from('local_materials').insert(rows);
  return !error;
}
