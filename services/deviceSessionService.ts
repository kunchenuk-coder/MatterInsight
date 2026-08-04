import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import { detectDeviceType, type DeviceType } from '../utils/deviceDetect';
import { getAppPortal, type AppPortal } from '../utils/appPortal';

export const DEVICE_KICKED_MESSAGE =
  '您的账号已在其他同类设备上登录，您已被迫下线';

/** @deprecated 旧全局 key，仅用于清理残留 */
const LEGACY_SESSION_ID_KEY = 'matter_insight_device_session_id';
const LEGACY_DEVICE_TYPE_KEY = 'matter_insight_device_type';

type DeviceSessionRow = {
  user_id: string;
  device_type: DeviceType;
  session_id: string;
  access_token: string | null;
  updated_at: string;
};

function fingerprintAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  if (trimmed.length <= 16) return trimmed;
  return trimmed.slice(-16);
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ds_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/** matter_insight_device_session_${portal}_${userId} */
export function deviceSessionIdKey(portal: AppPortal, userId: string): string {
  return `matter_insight_device_session_${portal}_${userId}`;
}

export function deviceTypeKey(portal: AppPortal, userId: string): string {
  return `matter_insight_device_type_${portal}_${userId}`;
}

export function getLocalDeviceSessionId(
  userId?: string | null,
  portal: AppPortal = getAppPortal()
): string | null {
  if (typeof window === 'undefined' || !userId) return null;
  return window.localStorage.getItem(deviceSessionIdKey(portal, userId));
}

export function getLocalDeviceType(
  userId?: string | null,
  portal: AppPortal = getAppPortal()
): DeviceType | null {
  if (typeof window === 'undefined' || !userId) return null;
  const value = window.localStorage.getItem(deviceTypeKey(portal, userId));
  return value === 'mobile' || value === 'desktop' ? value : null;
}

/** 只清除指定 portal + userId；可选清掉遗留的全局 key（不影响其他角色） */
export function clearLocalDeviceSession(
  userId?: string | null,
  portal: AppPortal = getAppPortal()
): void {
  if (typeof window === 'undefined') return;
  if (userId) {
    window.localStorage.removeItem(deviceSessionIdKey(portal, userId));
    window.localStorage.removeItem(deviceTypeKey(portal, userId));
  }
  // 清理旧版全局 key，避免继续踩踏（不 clear 全部 localStorage）
  window.localStorage.removeItem(LEGACY_SESSION_ID_KEY);
  window.localStorage.removeItem(LEGACY_DEVICE_TYPE_KEY);
}

function persistLocalDeviceSession(
  userId: string,
  sessionId: string,
  deviceType: DeviceType,
  portal: AppPortal
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(deviceSessionIdKey(portal, userId), sessionId);
  window.localStorage.setItem(deviceTypeKey(portal, userId), deviceType);
}

async function fetchDeviceSessionRow(
  userId: string,
  deviceType: DeviceType,
  portal: AppPortal
): Promise<{ row: DeviceSessionRow | null; failed: boolean }> {
  if (!isSupabaseConfigured()) return { row: null, failed: false };

  const { data, error } = await getSupabaseForPortal(portal)
    .from('user_device_sessions')
    .select('user_id, device_type, session_id, access_token, updated_at')
    .eq('user_id', userId)
    .eq('device_type', deviceType)
    .maybeSingle();

  if (error) {
    console.warn('[deviceSessionService] fetch:', error.message);
    return { row: null, failed: true };
  }
  return { row: data as DeviceSessionRow | null, failed: false };
}

/**
 * 登录/注册成功：写入本 portal + userId 的本地指纹，并 upsert DB（不改表结构）。
 */
export async function registerDeviceSession(
  userId: string,
  accessToken?: string | null,
  portal: AppPortal = getAppPortal()
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const deviceType = detectDeviceType();
  const sessionId = generateSessionId();
  const tokenFingerprint = fingerprintAccessToken(accessToken);

  persistLocalDeviceSession(userId, sessionId, deviceType, portal);

  const { error } = await getSupabaseForPortal(portal)
    .from('user_device_sessions')
    .upsert(
      {
        user_id: userId,
        device_type: deviceType,
        session_id: sessionId,
        access_token: tokenFingerprint,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_type' }
    );

  if (error) {
    console.error('[deviceSessionService] register:', error.message);
    // 不因 DB 暂时失败清掉本地指纹以外的 Auth；仅回滚本 portal 本地指纹
    clearLocalDeviceSession(userId, portal);
    return false;
  }

  return true;
}

/** 主动登出：仅当本机 session_id 与库中一致时才删除记录 */
export async function removeDeviceSession(
  userId: string,
  portal: AppPortal = getAppPortal()
): Promise<void> {
  if (!isSupabaseConfigured() || !userId) return;

  const deviceType = getLocalDeviceType(userId, portal) ?? detectDeviceType();
  const localId = getLocalDeviceSessionId(userId, portal);
  const { row } = await fetchDeviceSessionRow(userId, deviceType, portal);
  if (!row) return;
  if (localId && row.session_id !== localId) return;

  const { error } = await getSupabaseForPortal(portal)
    .from('user_device_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('device_type', deviceType)
    .eq('session_id', row.session_id);

  if (error) {
    console.error('[deviceSessionService] remove:', error.message);
  }
}

/**
 * 校验本机 session_id。
 * 网络/RLS 失败或暂时不一致 → 返回 true（不触发踢人）。
 * 仅在本地指纹与库中明确且持续不一致时返回 false。
 */
export async function validateDeviceSession(
  userId: string,
  portal: AppPortal = getAppPortal()
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return true;

  const deviceType = getLocalDeviceType(userId, portal) ?? detectDeviceType();
  const localId = getLocalDeviceSessionId(userId, portal);
  const { row, failed } = await fetchDeviceSessionRow(userId, deviceType, portal);

  if (failed) return true;

  const { data: sess } = await getSupabaseForPortal(portal).auth.getSession();
  const accessToken = sess.session?.access_token ?? null;

  if (!localId || !row) {
    // 暂时缺失：尝试补登记，失败也不视为顶号
    await registerDeviceSession(userId, accessToken, portal);
    return true;
  }

  if (row.session_id === localId) return true;

  // 同 token 指纹 → 同步本地 id，不踢
  const fp = fingerprintAccessToken(accessToken);
  if (fp && fp === row.access_token) {
    persistLocalDeviceSession(userId, row.session_id, row.device_type, portal);
    return true;
  }

  return false;
}

/**
 * 刷新恢复：无本地指纹则认领；查询失败视为暂时问题（返回 true）。
 */
export async function ensureDeviceSessionOnRestore(
  userId: string,
  accessToken?: string | null,
  portal: AppPortal = getAppPortal()
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return true;

  const deviceType = detectDeviceType();
  const localId = getLocalDeviceSessionId(userId, portal);
  const { row, failed } = await fetchDeviceSessionRow(userId, deviceType, portal);

  if (failed) return true;

  if (!localId) {
    await registerDeviceSession(userId, accessToken, portal);
    return true;
  }

  if (!row) {
    await registerDeviceSession(userId, accessToken, portal);
    return true;
  }

  if (row.session_id === localId) return true;

  const fp = fingerprintAccessToken(accessToken);
  if (fp && fp === row.access_token) {
    persistLocalDeviceSession(userId, row.session_id, row.device_type, portal);
    return true;
  }

  // 明确被同用户其他同类设备顶掉 → false；调用方不得因此跨 portal signOut
  return false;
}

/**
 * Realtime 守卫：仅监听当前 user；顶号回调由 hook 决定是否只退当前 portal。
 */
export function subscribeDeviceSessionGuard(
  userId: string,
  onKicked: () => void,
  portal: AppPortal = getAppPortal()
): () => void {
  if (!isSupabaseConfigured() || !userId) return () => {};

  const deviceType = getLocalDeviceType(userId, portal) ?? detectDeviceType();
  const filter = `user_id=eq.${userId}`;

  const supabase = getSupabaseForPortal(portal);
  const channel: RealtimeChannel = supabase
    .channel(`device-session:${portal}:${userId}:${deviceType}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_device_sessions',
        filter,
      },
      (payload) => {
        const row = payload.new as DeviceSessionRow;
        if (row.device_type !== deviceType) return;
        const localId = getLocalDeviceSessionId(userId, portal);
        if (row.session_id === localId) return;

        void (async () => {
          const { data: sess } = await getSupabaseForPortal(portal).auth.getSession();
          const fp = fingerprintAccessToken(sess.session?.access_token);
          if (fp && fp === row.access_token) {
            persistLocalDeviceSession(userId, row.session_id, row.device_type, portal);
            return;
          }
          if (!localId || row.session_id !== localId) {
            onKicked();
          }
        })();
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'user_device_sessions',
        filter,
      },
      (payload) => {
        const row = payload.old as DeviceSessionRow;
        if (row.device_type !== deviceType) return;
        const localId = getLocalDeviceSessionId(userId, portal);
        if (localId && row.session_id === localId) {
          onKicked();
        }
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
