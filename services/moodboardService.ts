import type { MoodBoard, MoodBoardItem } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

function rowToMoodBoard(row: {
  id: string;
  name: string;
  items: MoodBoardItem[];
  is_paid: boolean;
  max_materials: number;
}): MoodBoard {
  return {
    id: row.id,
    name: row.name,
    items: row.items ?? [],
    isPaid: row.is_paid,
    maxMaterials: row.max_materials,
  };
}

/** 加载当前用户的全部情绪板 */
export async function fetchMoodboards(userId: string): Promise<MoodBoard[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await getSupabase()
    .from('moodboards')
    .select('id, name, items, is_paid, max_materials')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[moodboardService] fetchMoodboards:', error.message);
    return [];
  }

  const boards = (data ?? []).map(rowToMoodBoard);
  if (boards.length === 0) {
    return [
      {
        id: `mb_${userId}_default`,
        name: '默认情绪板',
        items: [],
        isPaid: false,
        maxMaterials: 10,
      },
    ];
  }
  return boards;
}

/** 全量同步情绪板（按 user_id 先删后插，保证数据隔离） */
export async function syncMoodboards(
  userId: string,
  boards: MoodBoard[]
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const supabase = getSupabase();

  const { error: delError } = await supabase
    .from('moodboards')
    .delete()
    .eq('user_id', userId);

  if (delError) {
    console.error('[moodboardService] sync delete:', delError.message);
    return false;
  }

  if (boards.length === 0) return true;

  const rows = boards.map((b) => ({
    id: b.id,
    user_id: userId,
    name: b.name,
    items: b.items,
    is_paid: b.isPaid,
    max_materials: b.maxMaterials,
  }));

  const { error: insError } = await supabase.from('moodboards').insert(rows);
  if (insError) {
    console.error('[moodboardService] sync insert:', insError.message);
    return false;
  }
  return true;
}

/** 单条 upsert 情绪板 */
export async function upsertMoodboard(
  userId: string,
  board: MoodBoard
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const { error } = await getSupabase()
    .from('moodboards')
    .upsert(
      {
        id: board.id,
        user_id: userId,
        name: board.name,
        items: board.items,
        is_paid: board.isPaid,
        max_materials: board.maxMaterials,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) console.error('[moodboardService] upsert:', error.message);
  return !error;
}
