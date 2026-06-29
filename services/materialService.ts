import type { Material, PendingMaterial } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { parseOssObjectKey } from '../utils/parseOssObjectKey';
import { enrichMaterialsWithFreshImages } from './materialImageService';

type MaterialRow = {
  id: string;
  user_id: string;
  supplier_id: string;
  data: Material | PendingMaterial;
  status: string;
  is_pending: boolean;
  is_custom?: boolean | null;
  oss_object_key?: string | null;
};

const MATERIAL_SELECT =
  'id, user_id, supplier_id, data, status, is_pending, is_custom, oss_object_key';

function mergeRowOssKey(
  data: Material | PendingMaterial,
  rowKey?: string | null,
  isCustom?: boolean | null
): Material | PendingMaterial {
  const ossObjectKey =
    rowKey ??
    data.ossObjectKey ??
    parseOssObjectKey(data.image) ??
    undefined;
  const withOss = ossObjectKey ? { ...data, ossObjectKey } : data;
  if (isCustom === undefined || isCustom === null) return withOss;
  return { ...withOss, isCustom: isCustom };
}

function rowToMaterial(row: MaterialRow): Material {
  return mergeRowOssKey(row.data, row.oss_object_key, row.is_custom) as Material;
}

function rowToPending(row: MaterialRow): PendingMaterial {
  return mergeRowOssKey(row.data, row.oss_object_key, row.is_custom) as PendingMaterial;
}

/** 获取已发布材料库（探索页） */
export async function fetchPublishedMaterials(): Promise<Material[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('materials')
    .select(MATERIAL_SELECT)
    .eq('is_pending', false)
    .eq('status', '已发布');

  if (error) {
    console.error('[materialService] fetchPublished:', error.message);
    return [];
  }
  const materials = (data ?? []).map(rowToMaterial);
  return enrichMaterialsWithFreshImages(materials);
}

/** 获取待审核材料（管理员） */
export async function fetchPendingMaterials(): Promise<PendingMaterial[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabase()
    .from('materials')
    .select(MATERIAL_SELECT)
    .eq('is_pending', true);

  if (error) {
    console.error('[materialService] fetchPending:', error.message);
    return [];
  }
  const pending = (data ?? []).map(rowToPending);
  return enrichMaterialsWithFreshImages(pending);
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
    .select(MATERIAL_SELECT)
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
  return {
    published: await enrichMaterialsWithFreshImages(published),
    pending: await enrichMaterialsWithFreshImages(pending),
  };
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
    oss_object_key: material.ossObjectKey ?? parseOssObjectKey(material.image),
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
      oss_object_key: updated.ossObjectKey ?? parseOssObjectKey(updated.image),
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
      oss_object_key: updated.ossObjectKey ?? parseOssObjectKey(updated.image),
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
