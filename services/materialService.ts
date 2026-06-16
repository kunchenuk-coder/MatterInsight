import type { Material, PendingMaterial } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

type MaterialRow = {
  id: string;
  user_id: string;
  supplier_id: string;
  data: Material | PendingMaterial;
  status: string;
  is_pending: boolean;
};

function rowToMaterial(row: MaterialRow): Material {
  return row.data as Material;
}

function rowToPending(row: MaterialRow): PendingMaterial {
  return row.data as PendingMaterial;
}

/** 获取已发布材料库（探索页） */
export async function fetchPublishedMaterials(): Promise<Material[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('materials')
    .select('id, user_id, supplier_id, data, status, is_pending')
    .eq('is_pending', false)
    .eq('status', '已发布');

  if (error) {
    console.error('[materialService] fetchPublished:', error.message);
    return [];
  }
  return (data ?? []).map(rowToMaterial);
}

/** 获取待审核材料（管理员） */
export async function fetchPendingMaterials(): Promise<PendingMaterial[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('materials')
    .select('id, user_id, supplier_id, data, status, is_pending')
    .eq('is_pending', true);

  if (error) {
    console.error('[materialService] fetchPending:', error.message);
    return [];
  }
  return (data ?? []).map(rowToPending);
}

/** 获取某供应商自己的材料（已发布 + 待审/驳回） */
export async function fetchSupplierMaterials(
  supplierId: string
): Promise<{ published: Material[]; pending: PendingMaterial[] }> {
  if (!isSupabaseConfigured() || !supplierId) {
    return { published: [], pending: [] };
  }

  const { data, error } = await getSupabase()
    .from('materials')
    .select('id, user_id, supplier_id, data, status, is_pending')
    .eq('supplier_id', supplierId);

  if (error) {
    console.error('[materialService] fetchSupplier:', error.message);
    return { published: [], pending: [] };
  }

  const published: Material[] = [];
  const pending: PendingMaterial[] = [];
  for (const row of data ?? []) {
    if (row.is_pending) pending.push(rowToPending(row as MaterialRow));
    else published.push(rowToMaterial(row as MaterialRow));
  }
  return { published, pending };
}

/** 供应商提交新材料（图片 URL 已上传至 OSS） */
export async function submitPendingMaterial(
  userId: string,
  material: PendingMaterial
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const { error } = await getSupabase().from('materials').insert({
    id: material.id,
    user_id: userId,
    supplier_id: material.supplierId,
    data: material,
    status: material.status,
    is_pending: true,
  });

  if (error) console.error('[materialService] submit:', error.message);
  return !error;
}

/** 管理员审核通过 */
export async function approveMaterial(
  materialId: string,
  updated: Material
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabase()
    .from('materials')
    .update({
      data: updated,
      status: updated.status,
      is_pending: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', materialId);

  return !error;
}

/** 管理员驳回 */
export async function rejectMaterial(
  materialId: string,
  updated: PendingMaterial
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabase()
    .from('materials')
    .update({
      data: updated,
      status: updated.status,
      is_pending: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', materialId);

  return !error;
}

/** 删除材料 */
export async function deleteMaterial(
  supplierId: string,
  materialId: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const { error } = await getSupabase()
    .from('materials')
    .delete()
    .eq('id', materialId)
    .eq('supplier_id', supplierId);

  return !error;
}
