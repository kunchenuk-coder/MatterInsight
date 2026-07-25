import type { InspirationStory } from '../types/materialDetail';
import type { Material } from '../types';
import {
  readHumanDnaFromMaterial,
  republishMaterial,
} from './materialService';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { logMaterialEvent } from './eventLogService';
import { toMaterialDetail } from '../data/materialDetailMock';

export interface SubmitInspirationStoryPayload {
  material_id: string;
  story_text: string;
  status: 'pending' | 'approved';
  author_id: string;
  /** Brand/supplier official stories are public immediately after publish. */
  is_brand_story?: boolean;
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

/**
 * Insert inspiration story. Brand stories from material owner are auto-approved.
 */
export async function submitInspirationStory(
  payload: SubmitInspirationStoryPayload
): Promise<InspirationStory> {
  const status: InspirationStory['status'] = payload.is_brand_story
    ? 'approved'
    : payload.status === 'approved'
      ? 'approved'
      : 'pending';

  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabase().rpc('submit_inspiration_story', {
      p_material_id: payload.material_id,
      p_story_text: payload.story_text,
      p_is_brand_story: payload.is_brand_story ?? false,
    });

    if (error) {
      console.error('[inspirationStoryService] submit_inspiration_story:', error.message);
      throw new Error(error.message);
    }

    const row = data as { id: string; author_id: string; text: string; status: InspirationStory['status'] };
    return {
      id: row.id,
      author_id: row.author_id,
      text: row.text,
      status: row.status ?? status,
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
