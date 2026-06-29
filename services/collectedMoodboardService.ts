import type { MoodBoard } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { rowToMoodBoard } from './moodboardService';

type MoodboardRow = {
  id: string;
  user_id: string;
  name: string;
  items: MoodBoard['items'];
  is_paid: boolean;
  max_materials: number;
  visibility?: string | null;
  is_published?: boolean | null;
  published_at?: string | null;
};

export type ToggleCollectMoodboardResult =
  | { ok: true; collected: boolean }
  | { ok: false; error: string };

/** 收藏 / 取消收藏已发布公开情绪板 */
export async function toggleCollectMoodboard(
  userId: string,
  moodboardId: string
): Promise<ToggleCollectMoodboardResult> {
  if (!isSupabaseConfigured() || !userId || !moodboardId) {
    return { ok: false, error: '服务未配置' };
  }

  const supabase = getSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from('saved_moodboards')
    .select('moodboard_id')
    .eq('user_id', userId)
    .eq('moodboard_id', moodboardId)
    .maybeSingle();

  if (fetchError) {
    console.error('[collectedMoodboardService] toggle fetch:', fetchError.message);
    return { ok: false, error: '操作失败，请稍后重试' };
  }

  if (existing) {
    const { error } = await supabase
      .from('saved_moodboards')
      .delete()
      .eq('user_id', userId)
      .eq('moodboard_id', moodboardId);
    if (error) {
      console.error('[collectedMoodboardService] toggle delete:', error.message);
      return { ok: false, error: '取消收藏失败' };
    }
    return { ok: true, collected: false };
  }

  const { error: insertError } = await supabase
    .from('saved_moodboards')
    .insert({ user_id: userId, moodboard_id: moodboardId });

  if (insertError) {
    console.error('[collectedMoodboardService] toggle insert:', insertError.message);
    return { ok: false, error: '收藏失败，请确认该情绪板已公开发布' };
  }

  return { ok: true, collected: true };
}

/** 用户收藏的全部情绪板（「我的收藏」Tab） */
export async function getCollectedMoodboards(userId: string): Promise<MoodBoard[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const supabase = getSupabase();

  const { data: links, error: linksError } = await supabase
    .from('saved_moodboards')
    .select('moodboard_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (linksError) {
    console.error('[collectedMoodboardService] getCollected links:', linksError.message);
    return [];
  }

  const ids = (links ?? []).map((l) => l.moodboard_id as string);
  if (ids.length === 0) return [];

  const { data: boards, error: boardsError } = await supabase
    .from('moodboards')
    .select(
      'id, user_id, name, items, is_paid, max_materials, visibility, is_published, published_at'
    )
    .in('id', ids);

  if (boardsError) {
    console.error('[collectedMoodboardService] getCollected boards:', boardsError.message);
    return [];
  }

  const byId = new Map(
    ((boards ?? []) as MoodboardRow[]).map((row) => [
      row.id,
      rowToMoodBoard({
        id: row.id,
        name: row.name,
        items: row.items ?? [],
        is_paid: row.is_paid,
        max_materials: row.max_materials,
        visibility: row.visibility as MoodBoard['visibility'],
        is_published: row.is_published,
        published_at: row.published_at,
        user_id: row.user_id,
      }),
    ])
  );

  return ids.map((id) => byId.get(id)).filter((b): b is MoodBoard => Boolean(b));
}

/** 当前用户是否已收藏某情绪板 */
export async function isMoodboardCollected(
  userId: string,
  moodboardId: string
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId || !moodboardId) return false;

  const { data, error } = await getSupabase()
    .from('saved_moodboards')
    .select('moodboard_id')
    .eq('user_id', userId)
    .eq('moodboard_id', moodboardId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}
