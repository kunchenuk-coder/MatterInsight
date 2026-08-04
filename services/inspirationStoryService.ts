import type { InspirationStory } from '../types/materialDetail';
import type { Material } from '../types';
import {
  readHumanDnaFromMaterial,
  republishMaterial,
} from './materialService';
import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import { logMaterialEvent } from './eventLogService';
import { toMaterialDetail } from '../data/materialDetailMock';
import type { AppPortal } from '../utils/appPortal';

export interface SubmitInspirationStoryPayload {
  material_id: string;
  story_text: string;
  status: 'pending' | 'approved';
  author_id: string;
  /** Brand/supplier official stories — backend also checks profiles.role. */
  is_brand_story?: boolean;
  /** Prefer explicit portal so /material edit pages do not use designer JWT by default. */
  auth_portal?: AppPortal;
}

export interface PersistInspirationStoryOptions {
  material: Material;
  supplierId: string;
  stories: InspirationStory[];
}

/**
 * Persist inspiration stories into materials.data.humanDna (supplier-owned row).
 * Designers read via materials_select_published RLS — no separate table required.
 */
export async function persistInspirationStories(
  options: PersistInspirationStoryOptions
): Promise<boolean> {
  const { material, supplierId, stories } = options;
  const embedded = readHumanDnaFromMaterial(material) ?? toMaterialDetail(material);
  const humanDna = { ...embedded, inspiration_stories: stories };

  if (!isSupabaseConfigured()) {
    console.info('[inspirationStoryService] persistInspirationStories (local mock)', {
      material_id: material.id,
      stories,
    });
    return true;
  }

  const result = await republishMaterial(supplierId, material.id, material, humanDna);
  if (!result.ok) {
    console.error('[inspirationStoryService] persist failed:', result.error);
    return false;
  }
  return true;
}

function mapStoryStatus(
  remote: string | undefined,
  fallback: InspirationStory['status']
): InspirationStory['status'] {
  if (remote === 'published' || remote === 'approved') return 'approved';
  if (remote === 'rejected') return 'rejected';
  if (remote === 'pending_review' || remote === 'pending' || remote === 'reported') return 'pending';
  return fallback;
}

function rowToInspirationStory(row: {
  id: string;
  designer_id: string;
  content: string;
  status: string;
  title?: string | null;
  review_notes?: string | null;
  created_at?: string | null;
}): InspirationStory {
  return {
    id: String(row.id),
    author_id: String(row.designer_id),
    text: String(row.content ?? ''),
    status: mapStoryStatus(row.status, 'pending'),
    review_notes: row.review_notes ?? null,
    title: row.title ?? null,
    created_at: row.created_at ?? null,
  };
}

/**
 * Load stories for a material from V5 inspiration_stories.
 * RLS: published for all authenticated; authors also see own pending_review / rejected.
 */
export async function fetchMaterialInspirationStories(
  materialId: string,
  portal?: AppPortal
): Promise<InspirationStory[]> {
  if (!isSupabaseConfigured() || !materialId) return [];

  const client = getSupabaseForPortal(portal ?? 'designer');
  const { data, error } = await client
    .from('inspiration_stories')
    .select('id, designer_id, content, status, title, review_notes, created_at')
    .eq('material_id', materialId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[inspirationStoryService] fetchMaterialInspirationStories:', error.message);
    return [];
  }

  return (data ?? []).map((row) =>
    rowToInspirationStory(
      row as {
        id: string;
        designer_id: string;
        content: string;
        status: string;
        title?: string | null;
        review_notes?: string | null;
        created_at?: string | null;
      }
    )
  );
}

/**
 * Insert inspiration story into V5 inspiration_stories (always pending_review on server).
 */
export async function submitInspirationStory(
  payload: SubmitInspirationStoryPayload
): Promise<InspirationStory> {
  const isBrand = payload.is_brand_story ?? false;
  const status: InspirationStory['status'] = 'pending';
  const portal: AppPortal =
    payload.auth_portal ?? (isBrand ? 'supplier' : 'designer');

  if (isSupabaseConfigured()) {
    const client = getSupabaseForPortal(portal);
    const {
      data: { user: authUser },
    } = await client.auth.getUser();

    let profileRole: string | null = null;
    if (authUser?.id) {
      const { data: profile } = await client
        .from('profiles')
        .select('id, role, email, username, registered_phone')
        .eq('id', authUser.id)
        .maybeSingle();
      profileRole = profile?.role ?? null;
      console.info('[inspirationStoryService] submit context', {
        portal,
        authUserId: authUser.id,
        payloadAuthorId: payload.author_id,
        idsMatch: authUser.id === payload.author_id,
        profileRole,
        uiHint_is_brand_story: isBrand,
        p_material_id: payload.material_id,
        story_text_len: payload.story_text.trim().length,
        profile,
      });
    } else {
      console.warn('[inspirationStoryService] no auth user on portal', { portal });
    }

    const { data, error } = await client.rpc('submit_inspiration_story', {
      p_material_id: payload.material_id,
      p_story_text: payload.story_text,
      p_is_brand_story: isBrand,
    });

    if (error) {
      console.error('[inspirationStoryService] submit_inspiration_story:', error.message, {
        portal,
        profileRole,
        p_is_brand_story: isBrand,
      });
      throw new Error(error.message);
    }

    const row = data as {
      id: string;
      author_id: string;
      text: string;
      status?: string;
    };
    return {
      id: row.id,
      author_id: row.author_id,
      text: row.text,
      status: mapStoryStatus(row.status, status),
      review_notes: null,
    };
  }

  console.info('[inspirationStoryService] submitInspirationStory (local mock)', {
    material_id: payload.material_id,
    status,
  });

  logMaterialEvent(payload.author_id, payload.material_id, 'SUBMIT_STORY_X3', {
    story_text: payload.story_text,
    status,
    is_brand_story: payload.is_brand_story ?? false,
  });

  await new Promise((resolve) => setTimeout(resolve, 80));

  return {
    id: `story_${Date.now()}`,
    author_id: payload.author_id,
    text: payload.story_text,
    status,
  };
}

/** Resolve display label for story author (mock until profiles join). */
export function getStoryAuthorLabel(
  authorId: string,
  currentUserId?: string | null,
  materialSupplierId?: string
): string {
  if (currentUserId && authorId === currentUserId) return '我';
  if (materialSupplierId && authorId === materialSupplierId) return '品牌官方';
  if (authorId.startsWith('designer_')) {
    return `设计师 #${authorId.replace('designer_', '')}`;
  }
  return '设计师';
}
