import { useEffect, useRef } from 'react';
import {
  markNotificationsRead,
  type NotificationType,
} from '../services/notificationService';
import type { AppPortal } from '../utils/appPortal';

/**
 * 进入页面后自动将匹配类型的未读通知标记为已读。
 *
 * @example
 * // 材料商进入某材料详情 → 清除该材料的 tag_added
 * useMarkNotificationsRead({
 *   enabled: isSupplier && !!materialId,
 *   types: ['tag_added'],
 *   targetId: materialId,
 *   onMarked: refreshBadge,
 * });
 *
 * // 设计师进入灵感故事区 → 清除 story_featured
 * useMarkNotificationsRead({
 *   enabled: isDesigner,
 *   types: ['story_featured'],
 *   onMarked: refreshBadge,
 * });
 */
export function useMarkNotificationsRead(options: {
  enabled: boolean;
  types?: NotificationType[];
  targetId?: string | null;
  portal?: AppPortal;
  onMarked?: (count: number) => void;
}): void {
  const { enabled, types, targetId, portal, onMarked } = options;
  const onMarkedRef = useRef(onMarked);
  onMarkedRef.current = onMarked;
  const ranKey = useRef<string | null>(null);

  const typesKey = (types ?? []).join(',');

  useEffect(() => {
    if (!enabled) return;

    const key = `${typesKey}|${targetId ?? ''}|${portal ?? ''}`;
    if (ranKey.current === key) return;
    ranKey.current = key;

    const typeList = typesKey
      ? (typesKey.split(',') as NotificationType[])
      : undefined;

    let cancelled = false;
    void (async () => {
      const result = await markNotificationsRead({
        types: typeList,
        targetId,
        portal,
      });
      if (cancelled || !result.ok) return;
      if (result.count > 0) {
        onMarkedRef.current?.(result.count);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, portal, targetId, typesKey]);
}

export default useMarkNotificationsRead;
