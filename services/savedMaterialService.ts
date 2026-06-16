import { getSupabase, isSupabaseConfigured } from './supabaseClient';

/** 加载设计师收藏的材料 ID 列表 */
export async function fetchSavedMaterialIds(userId: string): Promise<string[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await getSupabase()
    .from('saved_materials')
    .select('material_id')
    .eq('user_id', userId);

  if (error) {
    console.error('[savedMaterialService] fetch:', error.message);
    return [];
  }
  return (data ?? []).map((r) => r.material_id as string);
}

/** 切换收藏状态 */
export async function toggleSavedMaterial(
  userId: string,
  materialId: string,
  save: boolean
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const supabase = getSupabase();
  if (save) {
    const { error } = await supabase
      .from('saved_materials')
      .upsert({ user_id: userId, material_id: materialId }, { onConflict: 'user_id,material_id' });
    return !error;
  }
  const { error } = await supabase
    .from('saved_materials')
    .delete()
    .eq('user_id', userId)
    .eq('material_id', materialId);
  return !error;
}

/** 全量同步收藏列表 */
export async function syncSavedMaterialIds(
  userId: string,
  ids: string[]
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const supabase = getSupabase();
  await supabase.from('saved_materials').delete().eq('user_id', userId);

  if (ids.length === 0) return true;

  const rows = ids.map((material_id) => ({ user_id: userId, material_id }));
  const { error } = await supabase.from('saved_materials').insert(rows);
  return !error;
}
