import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import { detectDeviceType, type DeviceType } from '../utils/deviceDetect';

export const DEVICE_KICKED_MESSAGE =
  '您的账号已在其他同类设备上登录，您已被迫下线';

const LOCAL_SESSION_ID_KEY = 'matter_insight_device_session_id';
const LOCAL_DEVICE_TYPE_KEY = 'matter_insight_device_type';

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

export function getLocalDeviceSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(LOCAL_SESSION_ID_KEY);
}

export function getLocalDeviceType(): DeviceType | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(LOCAL_DEVICE_TYPE_KEY);
  return value === 'mobile' || value === 'desktop' ? value : null;
}

export function clearLocalDeviceSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LOCAL_SESSION_ID_KEY);
  window.localStorage.removeItem(LOCAL_DEVICE_TYPE_KEY);
}

function persistLocalDeviceSession(sessionId: string, deviceType: DeviceType): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_SESSION_ID_KEY, sessionId);
  window.localStorage.setItem(LOCAL_DEVICE_TYPE_KEY, deviceType);
}

async function fetchDeviceSessionRow(
  userId: string,
  deviceType: DeviceType
): Promise<DeviceSessionRow | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await getSupabase()
    .from('user_device_sessions')
    .select('user_id, device_type, session_id, access_token, updated_at')
    .eq('user_id', userId)
    .eq('device_type', deviceType)
    .maybeSingle();

  if (error) {
    console.error('[deviceSessionService] fetch:', error.message);
    return null;
  }
  return data as DeviceSessionRow | null;
}

/**
 * 登录/注册成功：写入或覆盖同类设备会话（顶掉旧 session_id）。
 */
export async function registerDeviceSession(
  userId: string,
  accessToken?: string | null
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;

  const deviceType = detectDeviceType();
  const sessionId = generateSessionId();
  const tokenFingerprint = fingerprintAccessToken(accessToken);

  const { error } = await getSupabase()
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
    return false;
  }

  persistLocalDeviceSession(sessionId, deviceType);
  return true;
}

/** 主动登出：仅当本机 session_id 与库中一致时才删除记录 */
export async function removeDeviceSession(userId: string): Promise<void> {
  if (!isSupabaseConfigured() || !userId) return;

  const deviceType = getLocalDeviceType() ?? detectDeviceType();
  const localId = getLocalDeviceSessionId();
  const row = await fetchDeviceSessionRow(userId, deviceType);
  if (!row) return;
  if (localId && row.session_id !== localId) return;

  const { error } = await getSupabase()
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
 * 校验本机 session_id 是否仍为库中有效会话。
 */
export async function validateDeviceSession(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return true;

  const deviceType = getLocalDeviceType() ?? detectDeviceType();
  const localId = getLocalDeviceSessionId();
  if (!localId) return false;

  const row = await fetchDeviceSessionRow(userId, deviceType);
  if (!row) return false;
  return row.session_id === localId;
}

/**
 * 刷新恢复：无本地指纹则认领；有则校验是否被顶号。
 */
export async function ensureDeviceSessionOnRestore(
  userId: string,
  accessToken?: string | null
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return true;

  const deviceType = detectDeviceType();
  const localId = getLocalDeviceSessionId();
  const row = await fetchDeviceSessionRow(userId, deviceType);

  if (!localId) {
    return registerDeviceSession(userId, accessToken);
  }

  if (!row) {
    return registerDeviceSession(userId, accessToken);
  }

  return row.session_id === localId;
}

/**
 * Realtime 守卫：同类设备 session_id 被覆盖时回调 onKicked。
 */
export function subscribeDeviceSessionGuard(
  userId: string,
  onKicked: () => void
): () => void {
  if (!isSupabaseConfigured() || !userId) return () => {};

  const deviceType = getLocalDeviceType() ?? detectDeviceType();
  const filter = `user_id=eq.${userId}`;

  const supabase = getSupabase();
  const channel: RealtimeChannel = supabase
    .channel(`device-session:${userId}:${deviceType}`)
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
        const localId = getLocalDeviceSessionId();
        if (!localId || row.session_id !== localId) {
          onKicked();
        }
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
        const localId = getLocalDeviceSessionId();
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
