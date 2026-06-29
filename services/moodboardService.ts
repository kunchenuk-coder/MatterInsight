import type { MoodBoard, MoodBoardItem, MoodBoardVisibility } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { fetchProfileByEmail } from './profileService';
import { resolveDesignerDisplayName } from '../utils/profileDisplayName';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type MoodboardRealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export type MoodboardRealtimePayload = {
  event: MoodboardRealtimeEvent;
  board: MoodBoard;
};

export const DEFAULT_MOODBOARD_VISIBILITY: MoodBoardVisibility = 'private';

type MoodboardRow = {
  id: string;
  user_id: string;
  name: string;
  items: MoodBoardItem[];
  is_paid: boolean;
  max_materials: number;
  visibility?: MoodBoardVisibility | string | null;
  is_published?: boolean | null;
  published_at?: string | null;
  profiles?: {
    company?: string | null;
    username?: string | null;
    email?: string | null;
    avatar?: string | null;
  } | null;
};

/** Backward-compatible default for boards saved before visibility existed */
export function withDefaultVisibility(board: MoodBoard): MoodBoard {
  return {
    ...board,
    visibility: board.visibility ?? DEFAULT_MOODBOARD_VISIBILITY,
  };
}

export function rowToMoodBoard(row: {
  id: string;
  name: string;
  items: MoodBoardItem[];
  is_paid: boolean;
  max_materials: number;
  visibility?: MoodBoardVisibility | string | null;
  is_published?: boolean | null;
  published_at?: string | null;
  user_id?: string;
  profiles?: { name?: string | null; email?: string | null } | null;
}): MoodBoard {
  const profile = row.profiles;
  const ownerName = profile
    ? resolveDesignerDisplayName({
        company: profile.company,
        username: profile.username,
        email: profile.email,
      })
    : undefined;
  const ownerAvatar = profile?.avatar?.trim() || undefined;

  return withDefaultVisibility({
    id: row.id,
    name: row.name,
    items: row.items ?? [],
    isPaid: row.is_paid,
    maxMaterials: row.max_materials,
    visibility: (row.visibility as MoodBoardVisibility) ?? DEFAULT_MOODBOARD_VISIBILITY,
    isPublished: row.is_published ?? false,
    publishedAt: row.published_at ?? undefined,
    ownerId: row.user_id,
    ownerName,
    ownerAvatar,
  });
}

/** 加载当前用户的全部情绪板 */
export async function fetchMoodboards(userId: string): Promise<MoodBoard[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await getSupabase()
    .from('moodboards')
    .select('id, name, items, is_paid, max_materials, visibility, is_published, published_at')
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

/** 全量同步情绪板（upsert 已有行 + 删除已移除行，触发 Realtime UPDATE 而非先删后插） */
export async function syncMoodboards(
  userId: string,
  boards: MoodBoard[]
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const supabase = getSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from('moodboards')
    .select('id')
    .eq('user_id', userId);

  if (fetchError) {
    console.error('[moodboardService] sync fetch ids:', fetchError.message);
    return false;
  }

  const localIds = new Set(boards.map((b) => b.id));
  const idsToDelete = (existing ?? [])
    .map((row) => row.id)
    .filter((id) => !localIds.has(id));

  if (idsToDelete.length > 0) {
    const { error: delError } = await supabase
      .from('moodboards')
      .delete()
      .in('id', idsToDelete);
    if (delError) {
      console.error('[moodboardService] sync delete removed:', delError.message);
      return false;
    }
  }

  if (boards.length === 0) return true;

  const rows = boards.map((b) => ({
    id: b.id,
    user_id: userId,
    name: b.name,
    items: b.items,
    is_paid: b.isPaid,
    max_materials: b.maxMaterials,
    visibility: b.visibility ?? DEFAULT_MOODBOARD_VISIBILITY,
    is_published: b.isPublished ?? false,
    published_at: b.publishedAt ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from('moodboards')
    .upsert(rows, { onConflict: 'id' });

  if (upsertError) {
    console.error('[moodboardService] sync upsert:', upsertError.message);
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
        visibility: board.visibility ?? DEFAULT_MOODBOARD_VISIBILITY,
        is_published: board.isPublished ?? false,
        published_at: board.publishedAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) console.error('[moodboardService] upsert:', error.message);
  return !error;
}

function handleRealtimePayload(
  event: MoodboardRealtimeEvent,
  onChange: (payload: MoodboardRealtimePayload) => void,
  row: MoodboardRow | null
) {
  if (!row?.id) return;
  onChange({ event, board: rowToMoodBoard(row) });
}

/**
 * 订阅当前用户情绪板的 Realtime 变更（UPDATE 用于多端名字同步；INSERT/DELETE 用于新建/删除板）。
 * 返回取消订阅函数。
 */
export function subscribeMoodboardChanges(
  userId: string,
  onChange: (payload: MoodboardRealtimePayload) => void
): () => void {
  if (!isSupabaseConfigured() || !userId) return () => {};

  const supabase = getSupabase();
  const filter = `user_id=eq.${userId}`;

  const channel: RealtimeChannel = supabase
    .channel(`moodboards:${userId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'moodboards', filter },
      (payload) => handleRealtimePayload('UPDATE', onChange, payload.new as MoodboardRow)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'moodboards', filter },
      (payload) => handleRealtimePayload('INSERT', onChange, payload.new as MoodboardRow)
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'moodboards', filter },
      (payload) => handleRealtimePayload('DELETE', onChange, payload.old as MoodboardRow)
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[moodboardService] Realtime channel error');
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** 已发布公开情绪板（首页瀑布流） */
export async function fetchPublicMoodboards(): Promise<MoodBoard[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('moodboards')
    .select(
      'id, user_id, name, items, is_paid, max_materials, visibility, is_published, published_at'
    )
    .eq('visibility', 'public')
    .eq('is_published', true)
    .order('published_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[moodboardService] fetchPublicMoodboards:', error.message);
    return [];
  }

  const rows = data ?? [];
  const ownerIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const ownerProfiles = new Map<
    string,
    { company: string | null; username: string | null; email: string | null; avatar: string | null }
  >();

  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, company, username, email, avatar')
      .in('id', ownerIds);

    for (const p of profiles ?? []) {
      ownerProfiles.set(p.id as string, {
        company: (p.company as string | null) ?? null,
        username: (p.username as string | null) ?? null,
        email: (p.email as string | null) ?? null,
        avatar: (p.avatar as string | null) ?? null,
      });
    }
  }

  return rows.map((row) =>
    rowToMoodBoard({
      ...row,
      profiles: row.user_id ? ownerProfiles.get(row.user_id) ?? null : null,
    } as MoodboardRow)
  );
}

/** 团队协作者：按邮箱邀请（仅板主可操作） */
export async function inviteMoodboardCollaborator(
  ownerId: string,
  boardId: string,
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured() || !ownerId || !boardId) {
    return { ok: false, error: '服务未配置' };
  }

  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: '请输入协作者邮箱' };

  const profile = await fetchProfileByEmail(trimmed);
  if (!profile) return { ok: false, error: '未找到该邮箱对应的用户' };
  if (profile.id === ownerId) return { ok: false, error: '不能邀请自己' };

  const { error } = await getSupabase()
    .from('moodboard_collaborators')
    .upsert(
      {
        moodboard_id: boardId,
        user_id: profile.id,
        invited_by: ownerId,
      },
      { onConflict: 'moodboard_id,user_id' }
    );

  if (error) {
    console.error('[moodboardService] inviteCollaborator:', error.message);
    return { ok: false, error: '邀请失败，请稍后重试' };
  }

  return { ok: true };
}

export function publishMoodBoard(board: MoodBoard): MoodBoard {
  return withDefaultVisibility({
    ...board,
    visibility: 'public',
    isPublished: true,
    publishedAt: new Date().toISOString(),
  });
}

export function setMoodBoardVisibility(
  board: MoodBoard,
  visibility: MoodBoardVisibility
): MoodBoard {
  return withDefaultVisibility({ ...board, visibility });
}
