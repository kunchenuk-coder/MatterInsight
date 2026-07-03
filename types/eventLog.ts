/** Human DNA event actions (Phase 1). */
export type MaterialEventActionType =
  | 'EVALUATE_X1'
  | 'TAG_MOOD_X2'
  | 'SUBMIT_STORY_X3'
  | 'MOODBOARD_USE_X4';

export const MATERIAL_EVENT_ACTIONS: readonly MaterialEventActionType[] = [
  'EVALUATE_X1',
  'TAG_MOOD_X2',
  'SUBMIT_STORY_X3',
  'MOODBOARD_USE_X4',
] as const;

/** Payload shapes (all optional fields — store what the UI has). */
export type EvaluateEventPayload = {
  evaluations?: Record<string, number>;
  aggregate?: Record<string, number>;
};

export type TagMoodEventPayload = {
  tag?: string;
  is_custom?: boolean;
  is_brand_official?: boolean;
};

export type SubmitStoryEventPayload = {
  story_id?: string;
  story_text?: string;
  status?: string;
  is_brand_story?: boolean;
};

/** Z1 combination resonance — mixed material ids on a moodboard. */
export type MoodboardUseEventPayload = {
  moodboard_id?: string;
  material_ids?: string[];
  combination_key?: string;
};

export type MaterialEventPayload =
  | EvaluateEventPayload
  | TagMoodEventPayload
  | SubmitStoryEventPayload
  | MoodboardUseEventPayload
  | Record<string, unknown>;

export interface MaterialEventLogRow {
  id: string;
  user_id: string;
  material_id: string | null;
  action_type: MaterialEventActionType;
  payload: MaterialEventPayload;
  created_at: string;
}
