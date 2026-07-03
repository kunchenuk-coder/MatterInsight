import type { InspirationStory } from '../types/materialDetail';
import type { Material } from '../types';
import {
  readHumanDnaFromMaterial,
  republishMaterial,
} from './materialService';
import { isSupabaseConfigured } from './supabaseClient';
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

  const apiPayload = {
    material_id: payload.material_id,
    story_text: payload.story_text,
    status,
  };

  console.group('[inspirationStoryService] submitInspirationStory');
  console.log('Persisted in materials.data.humanDna.inspiration_stories');
  console.log('Request body:', apiPayload);
  console.groupEnd();

  await new Promise((resolve) => setTimeout(resolve, 80));

  const story: InspirationStory = {
    id: `story_${Date.now()}`,
    author_id: payload.author_id,
    text: payload.story_text,
    status,
  };

  return story;
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
