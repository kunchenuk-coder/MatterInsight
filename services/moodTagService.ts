import type { MaterialMoodTag } from '../types/materialDetail';
import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';

export type MoodTagWriteMode = 'brand' | 'custom';

function mapMoodTags(raw: unknown): MaterialMoodTag[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const t = item as Record<string, unknown>;
      if (!t?.tag) return null;
      return {
        tag: String(t.tag),
        count: typeof t.count === 'number' ? t.count : Number(t.count) || 0,
        is_custom: Boolean(t.is_custom),
        is_brand_official: Boolean(t.is_brand_official),
        author_id: t.author_id ? String(t.author_id) : undefined,
      } as MaterialMoodTag;
    })
    .filter(Boolean) as MaterialMoodTag[];
}

/**
 * Persist a mood tag into tag_pool + material_tag_relation + materials.data.humanDna.mood_tags.
 * Designers cannot UPDATE materials via RLS — this RPC is security definer.
 */
export async function persistMaterialMoodTag(options: {
  materialId: string;
  tagWord: string;
  mode: MoodTagWriteMode;
  portal?: AppPortal;
}): Promise<{ ok: true; mood_tags: MaterialMoodTag[] } | { ok: false; error: string }> {
  const tagWord = options.tagWord.trim();
  const payload = {
    p_material_id: options.materialId,
    p_tag_word: tagWord,
    p_is_brand: options.mode === 'brand',
  };

  console.info('[moodTagService] persistMaterialMoodTag REQUEST', {
    ...payload,
    mode: options.mode,
    portal: options.portal ?? (options.mode === 'brand' ? 'supplier' : 'designer'),
  });

  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const portal = options.portal ?? (options.mode === 'brand' ? 'supplier' : 'designer');
  const { data, error } = await getSupabaseForPortal(portal).rpc('submit_material_mood_tag', payload);

  if (error) {
    console.error('[moodTagService] persistMaterialMoodTag FAILED', error.message, payload);
    return { ok: false, error: error.message };
  }

  const mood_tags = mapMoodTags((data as { mood_tags?: unknown })?.mood_tags);
  console.info('[moodTagService] persistMaterialMoodTag OK', {
    materialId: options.materialId,
    mood_tags_count: mood_tags.length,
    mood_tags,
  });
  return { ok: true, mood_tags };
}

/** Designer +1 on an existing mood tag (updates materials.data.humanDna.mood_tags count). */
export async function voteMaterialMoodTag(options: {
  materialId: string;
  tagWord: string;
  portal?: AppPortal;
}): Promise<{ ok: true; mood_tags: MaterialMoodTag[] } | { ok: false; error: string }> {
  const payload = {
    p_material_id: options.materialId,
    p_tag_word: options.tagWord.trim(),
  };

  console.info('[moodTagService] voteMaterialMoodTag REQUEST', payload);

  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const portal = options.portal ?? 'designer';
  const { data, error } = await getSupabaseForPortal(portal).rpc('vote_material_mood_tag', payload);

  if (error) {
    console.error('[moodTagService] voteMaterialMoodTag FAILED', error.message, payload);
    return { ok: false, error: error.message };
  }

  const mood_tags = mapMoodTags((data as { mood_tags?: unknown })?.mood_tags);
  console.info('[moodTagService] voteMaterialMoodTag OK', {
    materialId: options.materialId,
    mood_tags,
  });
  return { ok: true, mood_tags };
}
