import type {
  MaterialEventActionType,
  MaterialEventPayload,
} from '../types/eventLog';
import { MATERIAL_EVENT_ACTIONS } from '../types/eventLog';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export type LogMaterialEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string };

function isValidActionType(value: string): value is MaterialEventActionType {
  return (MATERIAL_EVENT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Record a Human DNA interaction via Supabase RPC `log_material_event`.
 * Uses the authenticated session user — do not pass a spoofable user id from the client.
 *
 * @param userId — Must match the signed-in user (guard against accidental mismatches).
 * @param materialId — Catalog material id (text); null for cross-material / moodboard-only events.
 */
export async function logMaterialEvent(
  userId: string,
  materialId: string | null,
  actionType: MaterialEventActionType,
  payload: MaterialEventPayload = {}
): Promise<LogMaterialEventResult> {
  if (!userId?.trim()) {
    return { ok: false, error: 'userId is required' };
  }
  if (!isValidActionType(actionType)) {
    return { ok: false, error: `Invalid actionType: ${actionType}` };
  }

  if (!isSupabaseConfigured()) {
    console.info('[eventLogService] logMaterialEvent (local mock)', {
      userId,
      materialId,
      actionType,
      payload,
    });
    return { ok: true, eventId: `mock_${Date.now()}` };
  }

  const client = getSupabase();
  const { data: sessionData } = await client.auth.getUser();
  const sessionUserId = sessionData.user?.id;

  if (!sessionUserId) {
    return { ok: false, error: 'Not authenticated' };
  }
  if (sessionUserId !== userId) {
    return { ok: false, error: 'userId does not match authenticated session' };
  }

  const { data, error } = await client.rpc('log_material_event', {
    p_material_id: materialId,
    p_action_type: actionType,
    p_payload: payload,
  });

  if (error) {
    console.error('[eventLogService] logMaterialEvent:', error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true, eventId: String(data) };
}

/** Fire-and-forget wrapper for UI handlers (errors logged, never thrown). */
export function logMaterialEventSafe(
  userId: string,
  materialId: string | null,
  actionType: MaterialEventActionType,
  payload?: MaterialEventPayload
): void {
  void logMaterialEvent(userId, materialId, actionType, payload ?? {}).then((result) => {
    if (!result.ok) {
      console.warn('[eventLogService] logMaterialEventSafe failed:', result.error);
    }
  });
}
