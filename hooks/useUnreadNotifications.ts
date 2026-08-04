import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_UNREAD_COUNTS,
  fetchUnreadNotificationCounts,
  subscribeUnreadNotifications,
  type UnreadNotificationCounts,
} from '../services/notificationService';
import type { AppPortal } from '../utils/appPortal';

/**
 * Header 红点：查询 + Realtime 订阅未读 notifications。
 */
export function useUnreadNotifications(options: {
  userId: string | null | undefined;
  portal?: AppPortal;
  enabled?: boolean;
}): {
  counts: UnreadNotificationCounts;
  total: number;
  refresh: () => Promise<void>;
} {
  const { userId, portal, enabled = true } = options;
  const [counts, setCounts] = useState<UnreadNotificationCounts>({ ...EMPTY_UNREAD_COUNTS });

  const refresh = useCallback(async () => {
    if (!enabled || !userId) {
      setCounts({ ...EMPTY_UNREAD_COUNTS });
      return;
    }
    const next = await fetchUnreadNotificationCounts(portal);
    setCounts(next);
  }, [enabled, portal, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !userId) return;
    return subscribeUnreadNotifications(userId, () => {
      void refresh();
    }, portal);
  }, [enabled, portal, refresh, userId]);

  return { counts, total: counts.total, refresh };
}

export default useUnreadNotifications;
