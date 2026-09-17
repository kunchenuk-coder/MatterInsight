import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';

export type NotificationType =
  | 'tag_added'
  | 'inquiry'
  | 'sample_request'
  | 'story_featured'
  | 'quote_received'
  | 'project_adoption_approved'
  | 'story_pending_review'
  | 'evaluation_added'
  | 'evaluation_disputed'
  | 'supplier_pending_review';

export type UnreadNotificationCounts = {
  total: number;
  tag_added: number;
  inquiry: number;
  sample_request: number;
  story_featured: number;
  quote_received: number;
  project_adoption_approved: number;
  story_pending_review: number;
  evaluation_added: number;
  evaluation_disputed: number;
  supplier_pending_review: number;
};

export const EMPTY_UNREAD_COUNTS: UnreadNotificationCounts = {
  total: 0,
  tag_added: 0,
  inquiry: 0,
  sample_request: 0,
  story_featured: 0,
  quote_received: 0,
  project_adoption_approved: 0,
  story_pending_review: 0,
  evaluation_added: 0,
  evaluation_disputed: 0,
  supplier_pending_review: 0,
};

function clientFor(portal?: AppPortal) {
  return portal ? getSupabaseForPortal(portal) : getSupabase();
}

/** 统计当前用户未读通知（按 type 分组，必须限定 receiver_id） */
export async function fetchUnreadNotificationCounts(
  portal?: AppPortal
): Promise<UnreadNotificationCounts> {
  if (!isSupabaseConfigured()) return { ...EMPTY_UNREAD_COUNTS };

  const client = clientFor(portal);
  const { data: authData } = await client.auth.getUser();
  const receiverId = authData.user?.id;
  if (!receiverId) return { ...EMPTY_UNREAD_COUNTS };

  const { data, error } = await client
    .from('notifications')
    .select('type')
    .eq('receiver_id', receiverId)
    .eq('is_read', false);

  if (error) {
    console.error('[notificationService] fetchUnreadNotificationCounts:', error.message);
    return { ...EMPTY_UNREAD_COUNTS };
  }

  const counts: UnreadNotificationCounts = { ...EMPTY_UNREAD_COUNTS };
  for (const row of data ?? []) {
    const t = String((row as { type?: string }).type ?? '');
    if (t === 'total' || !(t in counts)) continue;
    counts[t as Exclude<keyof UnreadNotificationCounts, 'total'>] += 1;
    counts.total += 1;
  }
  return counts;
}

export type UnreadNotificationRow = { type: NotificationType; targetId: string | null };

/** 未读通知明细（材料商按材料展示角标） */
export async function fetchUnreadNotificationRows(
  portal?: AppPortal
): Promise<UnreadNotificationRow[]> {
  if (!isSupabaseConfigured()) return [];
  const client = clientFor(portal);
  const { data: authData } = await client.auth.getUser();
  const receiverId = authData.user?.id;
  if (!receiverId) return [];

  const { data, error } = await client
    .from('notifications')
    .select('type, target_id')
    .eq('receiver_id', receiverId)
    .eq('is_read', false);

  if (error) {
    console.error('[notificationService] fetchUnreadNotificationRows:', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    type: String((row as { type?: string }).type ?? '') as NotificationType,
    targetId: (row as { target_id?: string | null }).target_id
      ? String((row as { target_id?: string | null }).target_id)
      : null,
  }));
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
