import type { Material } from '../types';

/** Application case image for slider display and LoRA training (max 10). */
export interface MaterialApplicationCase {
  id: string;
  url: string;
  is_for_training: boolean;
}

/** Human DNA evaluation ratings for the detail-page slider. */
export interface MaterialEvaluations {
  durability: number;
  service: number;
  aesthetics: number;
  cleanliness: number;
  recommendation: number;
}

/** Mood label with dynamic click vector; custom tags are designer-authored. */
export interface MaterialMoodTag {
  tag: string;
  count: number;
  /** Designer-authored community tag */
  is_custom?: boolean;
  /** Supplier official brand tag (max 3) */
  is_brand_official?: boolean;
  /** Designer who created a custom tag (for per-designer limits) */
  author_id?: string;
}

export type InspirationStoryStatus = 'pending' | 'approved' | 'rejected';

/** Designer note submitted for the Human Aesthetic Chain. */
export interface InspirationStory {
  id: string;
  author_id: string;
  text: string;
  status: InspirationStoryStatus;
}

/**
 * Human DNA (Human Aesthetic Chain) fields for the Material Detail Page.
 * Kept separate from base `Material` so list/card views stay lightweight.
 */
export interface MaterialHumanDna {
  /** Whether the material is ready for AI inpainting. */
  ai_trained_status: boolean;
  /** Up to 10 images for slider and LoRA training. */
  application_cases: MaterialApplicationCase[];
  evaluations: MaterialEvaluations;
  mood_tags: MaterialMoodTag[];
  evaluation_vote_count?: number;
  inspiration_stories: InspirationStory[];
}

/** Full material payload for the Material Detail Page. */
export type MaterialDetail = Material & MaterialHumanDna;
