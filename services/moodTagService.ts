import type { MaterialMoodTag } from '../types/materialDetail';
import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';
import { isLocalizedObject, type LocalizedText } from '../utils/localizedText';

export type MoodTagWriteMode = 'brand' | 'custom';

function mapMoodTags(raw: unknown): MaterialMoodTag[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const t = item as Record<string, unknown>;
      if (t?.tag == null || t.tag === '') return null;
      const tag: LocalizedText = isLocalizedObject(t.tag)
        ? t.tag
        : String(t.tag);
      return {
        tag,
        count: typeof t.count === 'number' ? t.count : Number(t.count) || 0,
        is_custom: Boolean(t.is_custom),
        is_brand_official: Boolean(t.is_brand_official),
        author_id: t.author_id ? String(t.author_id) : undefined,
      } as MaterialMoodTag;
    })
    .filter(Boolean) as MaterialMoodTag[];
}

/**
 * 详情页情绪标签权威来源：RPC 优先读 humanDna，空则从 material_tag_relation 重建。
 */
export async function fetchMaterialMoodTags(
  materialId: string,
  portal?: AppPortal
): Promise<MaterialMoodTag[]> {
  if (!isSupabaseConfigured() || !materialId) return [];

  const sb = portal ? getSupabaseForPortal(portal) : getSupabase();
  const { data, error } = await sb.rpc('list_material_mood_tags', {
    p_material_id: materialId,
  });

  if (error) {
    console.warn('[moodTagService] list_material_mood_tags failed, fallback select:', error.message);
    const { data: row, error: selErr } = await sb
      .from('materials')
      .select('data')
      .eq('id', materialId)
      .maybeSingle();
    if (selErr) {
      console.error('[moodTagService] fetchMaterialMoodTags select:', selErr.message);
      return [];
    }
    const embedded = (row?.data as { humanDna?: { mood_tags?: unknown } } | null)?.humanDna
      ?.mood_tags;
    return mapMoodTags(embedded);
  }

  // RPC may return array directly or { mood_tags: [...] }
  if (Array.isArray(data)) return mapMoodTags(data);
  return mapMoodTags((data as { mood_tags?: unknown } | null)?.mood_tags);
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
