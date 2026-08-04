import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';

export type NotificationType =
  | 'tag_added'
  | 'inquiry'
  | 'sample_request'
  | 'story_featured'
  | 'quote_received';

export type UnreadNotificationCounts = {
  total: number;
  tag_added: number;
  inquiry: number;
  sample_request: number;
  story_featured: number;
  quote_received: number;
};

export const EMPTY_UNREAD_COUNTS: UnreadNotificationCounts = {
  total: 0,
  tag_added: 0,
  inquiry: 0,
  sample_request: 0,
  story_featured: 0,
  quote_received: 0,
};

function clientFor(portal?: AppPortal) {
  return portal ? getSupabaseForPortal(portal) : getSupabase();
}

/** 统计当前用户未读通知（按 type 分组） */
export async function fetchUnreadNotificationCounts(
  portal?: AppPortal
): Promise<UnreadNotificationCounts> {
  if (!isSupabaseConfigured()) return { ...EMPTY_UNREAD_COUNTS };

  const { data, error } = await clientFor(portal)
    .from('notifications')
    .select('type')
    .eq('is_read', false);

  if (error) {
    console.error('[notificationService] fetchUnreadNotificationCounts:', error.message);
    return { ...EMPTY_UNREAD_COUNTS };
  }

  const counts: UnreadNotificationCounts = { ...EMPTY_UNREAD_COUNTS };
  for (const row of data ?? []) {
    const t = String((row as { type?: string }).type ?? '') as NotificationType;
    if (t in counts && t !== 'total') {
      counts[t] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

/** 写入一条未读通知（走 security definer RPC） */
export async function createNotification(options: {
  receiverId: string;
  type: NotificationType;
  targetId?: string | null;
  senderId?: string | null;
  portal?: AppPortal;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }
  if (!options.receiverId) {
    return { ok: false, error: 'receiverId required' };
  }

  const { data, error } = await clientFor(options.portal).rpc('create_notification', {
    p_receiver_id: options.receiverId,
    p_type: options.type,
    p_target_id: options.targetId ?? null,
    p_sender_id: options.senderId ?? null,
  });

  if (error) {
    console.error('[notificationService] createNotification:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: String(data) };
}

/** 标记已读：可按 type[] / target_id 过滤 */
export async function markNotificationsRead(options?: {
  types?: NotificationType[];
  targetId?: string | null;
  portal?: AppPortal;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const { data, error } = await clientFor(options?.portal).rpc('mark_notifications_read', {
    p_types: options?.types?.length ? options.types : null,
    p_target_id: options?.targetId ?? null,
  });

  if (error) {
    console.error('[notificationService] markNotificationsRead:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, count: Number(data) || 0 };
}

/** 订阅当前用户 notifications 变更（Realtime） */
export function subscribeUnreadNotifications(
  userId: string,
  onChange: () => void,
  portal?: AppPortal
): () => void {
  if (!isSupabaseConfigured() || !userId) return () => {};

  const client = clientFor(portal);
  const channel = client
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `receiver_id=eq.${userId}`,
      },
      () => onChange()
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
