import { useCallback } from 'react';
import type { MaterialEventActionType, MaterialEventPayload } from '../types/eventLog';
import {
  logMaterialEvent,
  logMaterialEventSafe,
  type LogMaterialEventResult,
} from '../services/eventLogService';

/**
 * React hook for Human DNA event logging.
 *
 * @example
 * const { logEvent, logEventSafe } = useMaterialEventLog(user?.id);
 * await logEvent(material.id, 'TAG_MOOD_X2', { tag: '极简' });
 */
export function useMaterialEventLog(userId: string | null | undefined) {
  const logEvent = useCallback(
    async (
      materialId: string | null,
      actionType: MaterialEventActionType,
      payload?: MaterialEventPayload
    ): Promise<LogMaterialEventResult> => {
      if (!userId) {
        return { ok: false, error: 'userId is required' };
      }
      return logMaterialEvent(userId, materialId, actionType, payload ?? {});
    },
    [userId]
  );

  const logEventSafe = useCallback(
    (
      materialId: string | null,
      actionType: MaterialEventActionType,
      payload?: MaterialEventPayload
    ) => {
      if (!userId) return;
      logMaterialEventSafe(userId, materialId, actionType, payload);
    },
    [userId]
  );

  return { logEvent, logEventSafe, isReady: Boolean(userId) };
}

export default useMaterialEventLog;
