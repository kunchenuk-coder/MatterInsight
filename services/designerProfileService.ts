import type { DesignerMoodboardSummary, DesignerProfile, DesignerSocialStats, Material, MoodBoard } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { rowToMoodBoard } from './moodboardService';
import {
  getMoodboardCoverImage,
  moodboardMaterialCount,
} from '../utils/moodboardFeedUtils';

type ProfileRow = {
  id: string;
  username: string | null;
  avatar: string | null;
  bio: string | null;
  company: string | null;
  role: string;
};

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

function toSummary(board: MoodBoard, materials: Material[]): DesignerMoodboardSummary {
  return {
    id: board.id,
    name: board.name,
    coverImage: getMoodboardCoverImage(board, materials),
    materialCount: moodboardMaterialCount(board),
    publishedAt: board.publishedAt,
  };
}

function emptyStats(): DesignerSocialStats {
  return { followersCount: 0, followingCount: 0, moodboardFavoritesCount: 0 };
}

async function fetchDesignerSocialStats(designerId: string): Promise<DesignerSocialStats> {
  if (!isSupabaseConfigured() || !designerId) return emptyStats();

  const { data, error } = await getSupabase().rpc('designer_social_stats', {
    p_designer_id: designerId,
  });

  if (error) {
    console.error('[designerProfileService] designer_social_stats:', error.message);
    return emptyStats();
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return emptyStats();

  return {
    followersCount: Number(row.followers_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    moodboardFavoritesCount: Number(row.moodboard_favorites_count ?? 0),
  };
}

/**
 * 设计师公开主页：头像、用户名、简介、已发布公开情绪板及项目缩略图。
 * @param id auth.users.id（设计师 user id）
 */
export async function getDesignerProfile(id: string): Promise<DesignerProfile | null> {
  if (!isSupabaseConfigured() || !id) return null;

  const supabase = getSupabase();

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar, bio, company, role')
    .eq('id', id)
    .maybeSingle();

  if (profileError) {
    console.error('[designerProfileService] getDesignerProfile profile:', profileError.message);
    return null;
  }
  if (!profile) return null;

  const row = profile as ProfileRow;
  if ((row.role ?? '').toLowerCase() !== 'designer') return null;

  const { data: boardRows, error: boardsError } = await supabase
    .from('moodboards')
    .select(
      'id, user_id, name, items, is_paid, max_materials, visibility, is_published, published_at'
    )
    .eq('user_id', id)
    .eq('visibility', 'public')
    .eq('is_published', true)
    .order('published_at', { ascending: false, nullsFirst: false });

  if (boardsError) {
    console.error('[designerProfileService] getDesignerProfile boards:', boardsError.message);
    return null;
  }

  const boards = ((boardRows ?? []) as MoodboardRow[]).map((r) =>
    rowToMoodBoard({
      id: r.id,
      name: r.name,
      items: r.items ?? [],
      is_paid: r.is_paid,
      max_materials: r.max_materials,
      visibility: r.visibility as MoodBoard['visibility'],
      is_published: r.is_published,
      published_at: r.published_at,
      user_id: r.user_id,
    })
  );

  const summaries = boards.map((b) => toSummary(b, []));
  const projectThumbnails = summaries
    .map((s) => s.coverImage)
    .filter((url): url is string => Boolean(url));

  const stats = await fetchDesignerSocialStats(id);

  return {
    id: row.id,
    avatar: row.avatar ?? null,
    username: row.username?.trim() || row.id.slice(0, 8),
    company: row.company ?? null,
    bio: row.bio ?? null,
    stats,
    publicMoodboards: summaries,
    boards,
    projectThumbnails,
  };
}
