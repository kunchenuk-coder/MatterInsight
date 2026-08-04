import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';

export type AdminStoryRow = {
  id: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  designer_id: string;
  material_id: string | null;
  author_role: string | null;
  author_email: string | null;
  material_name: string | null;
  review_notes: string | null;
  is_brand_hint: boolean;
};

export type AdminMoodTagChip = {
  /** Normalized tag display name */
  tag_name: string;
  /** Heat / vote count */
  count: number;
  is_brand: boolean;
  is_custom: boolean;
  /** relation row ids (if any) for cleanup */
  relation_ids: string[];
};

/** One row per material — AI-friendly Material → [tags] shape */
export type AdminMaterialMoodGroup = {
  material_id: string;
  material_name: string;
  tags: AdminMoodTagChip[];
};

/** @deprecated use AdminMaterialMoodGroup; kept for delete helper args */
export type AdminMoodTagRow = {
  id: string;
  source: 'relation' | 'embedded';
  material_id: string;
  material_name: string;
  tag_name: string;
  tag_dimension: string | null;
  tagged_by: string | null;
  tag_type: string | null;
};

function adminClient() {
  return getSupabaseForPortal('admin');
}

function mapAdminStoryRow(row: Record<string, unknown>): AdminStoryRow {
  const profile = row.profiles as { role?: string; email?: string } | null;
  const material = row.materials as { data?: { name?: string } } | null;
  const role = (profile?.role ?? '').toLowerCase();
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    content: String(row.content ?? ''),
    status: String(row.status ?? ''),
    created_at: String(row.created_at ?? ''),
    designer_id: String(row.designer_id ?? ''),
    material_id: row.material_id ? String(row.material_id) : null,
    author_role: profile?.role ?? null,
    author_email: profile?.email ?? null,
    material_name: material?.data?.name ?? null,
    review_notes: row.review_notes ? String(row.review_notes) : null,
    is_brand_hint: role === 'supplier',
  };
}

const STORY_SELECT = `
  id,
  title,
  content,
  status,
  created_at,
  updated_at,
  designer_id,
  material_id,
  review_notes,
  profiles:designer_id ( role, email ),
  materials:material_id ( data )
`;

/** Pending inspiration stories for admin review. */
export async function fetchPendingInspirationStories(): Promise<AdminStoryRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await adminClient()
    .from('inspiration_stories')
    .select(STORY_SELECT)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[adminModerationService] fetchPendingInspirationStories:', error.message);
    return [];
  }

  return (data ?? []).map((row) => mapAdminStoryRow(row as Record<string, unknown>));
}

/** Reviewed stories: published / rejected / reported (not pending_review). */
export async function fetchInspirationStoryHistory(): Promise<AdminStoryRow[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await adminClient()
    .from('inspiration_stories')
    .select(STORY_SELECT)
    .neq('status', 'pending_review')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[adminModerationService] fetchInspirationStoryHistory:', error.message);
    return [];
  }

  return (data ?? []).map((row) => mapAdminStoryRow(row as Record<string, unknown>));
}

export async function approveInspirationStory(storyId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  const { error } = await adminClient()
    .from('inspiration_stories')
    .update({ status: 'published', updated_at: new Date().toISOString(), review_notes: null })
    .eq('id', storyId);

  if (error) {
    console.error('[adminModerationService] approveInspirationStory:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function rejectInspirationStory(
  storyId: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  const { error } = await adminClient()
    .from('inspiration_stories')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
      review_notes: reason?.trim() || null,
    })
    .eq('id', storyId);

  if (error) {
    console.error('[adminModerationService] rejectInspirationStory:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function deleteInspirationStory(storyId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  const { error } = await adminClient().from('inspiration_stories').delete().eq('id', storyId);

  if (error) {
    console.error('[adminModerationService] deleteInspirationStory:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Aggregate mood tags by material for admin UI + AI-ready shape:
 * Material → [{ tag_name, count, is_brand, is_custom }]
 *
 * Sources merged (same tag_name → one chip):
 * 1) materials.data.humanDna.mood_tags
 * 2) material_tag_relation → tag_pool.tag_word
 */
export async function fetchAdminMoodTags(): Promise<AdminMaterialMoodGroup[]> {
  if (!isSupabaseConfigured()) return [];

  const client = adminClient();
  type AccTag = AdminMoodTagChip;
  const byMaterial = new Map<
    string,
    { material_name: string; tags: Map<string, AccTag> }
  >();

  const ensureMaterial = (materialId: string, materialName: string) => {
    let entry = byMaterial.get(materialId);
    if (!entry) {
      entry = { material_name: materialName || '（未命名材料）', tags: new Map() };
      byMaterial.set(materialId, entry);
    } else if (materialName && entry.material_name === '（未命名材料）') {
      entry.material_name = materialName;
    }
    return entry;
  };

  const upsertTag = (
    materialId: string,
    materialName: string,
    partial: {
      tag_name: string;
      count?: number;
      is_brand?: boolean;
      is_custom?: boolean;
      relation_id?: string;
    }
  ) => {
    const key = partial.tag_name.trim().toLowerCase();
    if (!key) return;
    const entry = ensureMaterial(materialId, materialName);
    const existing = entry.tags.get(key);
    if (!existing) {
      entry.tags.set(key, {
        tag_name: partial.tag_name.trim(),
        count: partial.count ?? 0,
        is_brand: !!partial.is_brand,
        is_custom: !!partial.is_custom,
        relation_ids: partial.relation_id ? [partial.relation_id] : [],
      });
      return;
    }
    existing.count = Math.max(existing.count, partial.count ?? 0);
    existing.is_brand = existing.is_brand || !!partial.is_brand;
    existing.is_custom = existing.is_custom || !!partial.is_custom;
    if (partial.relation_id && !existing.relation_ids.includes(partial.relation_id)) {
      existing.relation_ids.push(partial.relation_id);
    }
    // Prefer original casing from first write; keep if brand later
    if (partial.is_brand) existing.tag_name = partial.tag_name.trim();
  };

  const { data: materials, error: matError } = await client
    .from('materials')
    .select('id, supplier_id, data')
    .eq('is_pending', false);

  if (matError) {
    console.error('[adminModerationService] materials mood_tags:', matError.message);
  } else {
    for (const m of materials ?? []) {
      const materialId = String(m.id);
      const data = m.data as {
        name?: string;
        humanDna?: {
          mood_tags?: Array<{
            tag: string;
            count?: number;
            is_brand_official?: boolean;
            is_custom?: boolean;
            author_id?: string;
          }>;
        };
      } | null;
      const name = data?.name ?? '（未命名材料）';
      const tags = data?.humanDna?.mood_tags ?? [];
      if (tags.length === 0) continue;
      for (const t of tags) {
        if (!t?.tag) continue;
        upsertTag(materialId, name, {
          tag_name: t.tag,
          count: typeof t.count === 'number' ? t.count : 0,
          is_brand: !!t.is_brand_official,
          is_custom: !!t.is_custom,
        });
      }
    }
  }

  const { data: relations, error: relError } = await client
    .from('material_tag_relation')
    .select(
      `
      id,
      material_id,
      tagged_by,
      tag_type,
      tag_pool:tag_id ( tag_word ),
      materials:material_id ( data )
    `
    );

  if (relError) {
    console.error('[adminModerationService] material_tag_relation:', relError.message);
  } else {
    for (const row of relations ?? []) {
      const r = row as Record<string, unknown>;
      const tag = r.tag_pool as { tag_word?: string } | null;
      const material = r.materials as { data?: { name?: string } } | null;
      const tagWord = tag?.tag_word?.trim();
      if (!tagWord) continue;
      const tagType = String(r.tag_type ?? '');
      upsertTag(String(r.material_id), material?.data?.name ?? '（未命名材料）', {
        tag_name: tagWord,
        count: 0,
        is_brand: tagType.includes('官方'),
        is_custom: tagType.includes('自定义'),
        relation_id: String(r.id),
      });
    }
  }

  console.info('[adminModerationService] fetchAdminMoodTags AGGREGATED', {
    materials_with_tags: byMaterial.size,
    relation_rows: relations?.length ?? 0,
  });

  return Array.from(byMaterial.entries())
    .map(([material_id, entry]) => ({
      material_id,
      material_name: entry.material_name,
      tags: Array.from(entry.tags.values()).sort((a, b) => {
        if (a.is_brand !== b.is_brand) return a.is_brand ? -1 : 1;
        return b.count - a.count || a.tag_name.localeCompare(b.tag_name, 'zh');
      }),
    }))
    .filter((g) => g.tags.length > 0)
    .sort((a, b) => a.material_name.localeCompare(b.material_name, 'zh'));
}

/** Remove one tag from a material (embedded JSON + related relation rows). */
export async function deleteAdminMaterialMoodTag(options: {
  material_id: string;
  tag_name: string;
  relation_ids?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  const client = adminClient();
  const tagName = options.tag_name.trim();
  const materialId = options.material_id;

  for (const relationId of options.relation_ids ?? []) {
    const { error } = await client.from('material_tag_relation').delete().eq('id', relationId);
    if (error) {
      console.error('[adminModerationService] delete relation tag:', error.message);
      return { ok: false, error: error.message };
    }
  }

  // Also wipe any leftover relations for this material+tag via join lookup
  const { data: leftover } = await client
    .from('material_tag_relation')
    .select('id, tag_pool:tag_id ( tag_word )')
    .eq('material_id', materialId);

  for (const row of leftover ?? []) {
    const r = row as { id: string; tag_pool?: { tag_word?: string } | null };
    if ((r.tag_pool?.tag_word ?? '').toLowerCase() === tagName.toLowerCase()) {
      await client.from('material_tag_relation').delete().eq('id', r.id);
    }
  }

  const { data, error: fetchError } = await client
    .from('materials')
    .select('id, data')
    .eq('id', materialId)
    .maybeSingle();

  if (fetchError || !data) {
    return { ok: false, error: fetchError?.message ?? 'material not found' };
  }

  const payload = { ...(data.data as Record<string, unknown>) };
  const humanDna = {
    ...((payload.humanDna as Record<string, unknown>) ?? {}),
  };
  const moodTags = Array.isArray(humanDna.mood_tags)
    ? [...(humanDna.mood_tags as Array<{ tag: string; is_brand_official?: boolean }>)]
    : [];
  humanDna.mood_tags = moodTags.filter(
    (t) => (t.tag ?? '').toLowerCase() !== tagName.toLowerCase()
  );
  payload.humanDna = humanDna;

  const official = (humanDna.mood_tags as Array<{ tag: string; is_brand_official?: boolean }>)
    .filter((t) => t.is_brand_official)
    .map((t) => t.tag)
    .slice(0, 3);

  const { error } = await client
    .from('materials')
    .update({
      data: payload,
      official_mood_tags: official,
      updated_at: new Date().toISOString(),
    })
    .eq('id', materialId);

  if (error) {
    console.error('[adminModerationService] delete material mood tag:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** @deprecated prefer deleteAdminMaterialMoodTag */
export async function deleteAdminMoodTag(row: AdminMoodTagRow): Promise<{ ok: boolean; error?: string }> {
  return deleteAdminMaterialMoodTag({
    material_id: row.material_id,
    tag_name: row.tag_name,
    relation_ids: row.source === 'relation' ? [row.id] : [],
  });
}
