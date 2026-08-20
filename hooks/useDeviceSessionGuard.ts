import { useEffect, useRef } from 'react';
import { getSupabaseForPortal, isSupabaseConfigured } from '../services/supabaseClient';
import { isPasswordRecoveryMode } from '../utils/authRoutes';
import {
  AUTH_STORAGE_KEYS,
  getAppPortal,
  setPortalOverride,
  type AppPortal,
} from '../utils/appPortal';
import {
  DEVICE_KICKED_MESSAGE,
  clearLocalDeviceSession,
  subscribeDeviceSessionGuard,
  validateDeviceSession,
} from '../services/deviceSessionService';

const POLL_INTERVAL_MS = 30_000;
const LOGIN_LANDING_PATH = '/login';

const ALL_PORTALS: AppPortal[] = ['designer', 'supplier', 'admin'];

let kickInProgress = false;

/**
 * 互踢「全退」：清除同浏览器全部 Portal 的 Auth Session + 设备指纹，
 * 再硬跳 /login，禁止静默恢复任一角色。
 */
async function clearAllPortalSessions(userId?: string): Promise<void> {
  setPortalOverride(null);

  await Promise.all(
    ALL_PORTALS.map(async (portal) => {
      try {
        await getSupabaseForPortal(portal).auth.signOut();
      } catch {
        /* 单 portal 失败不阻断全退 */
      }
      if (userId) {
        clearLocalDeviceSession(userId, portal);
      }
      try {
        window.localStorage.removeItem(AUTH_STORAGE_KEYS[portal]);
      } catch {
        /* ignore */
      }
    })
  );
}

/**
 * 仅在「同用户 + 同类设备被明确顶号」时触发。
 * 全退所有 Portal，强制重新登录（/login），禁止 assign 原路径造成身份污染。
 */
async function executeDeviceKick(userId?: string): Promise<void> {
  if (kickInProgress) return;
  kickInProgress = true;
  try {
    await clearAllPortalSessions(userId);
    window.alert(DEVICE_KICKED_MESSAGE);
    window.location.replace(LOGIN_LANDING_PATH);
  } finally {
    kickInProgress = false;
  }
}

/**
 * 全局设备会话守卫：轮询 + Realtime。
 * 查询失败 / 暂时不一致 → 不踢；仅明确顶号才「全退」并跳转 /login。
 */
export function useDeviceSessionGuard(
  userId: string | undefined,
  onKicked?: () => void
): void {
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

  useEffect(() => {
    if (!isSupabaseConfigured() || !userId || isPasswordRecoveryMode()) return;

    const portal = getAppPortal();
    let stopped = false;
    let mismatchStreak = 0;

    const kick = () => {
      if (stopped) return;
      onKickedRef.current?.();
      void executeDeviceKick(userId);
    };

    const check = async () => {
      if (stopped) return;
      const valid = await validateDeviceSession(userId, portal);
      if (valid) {
        mismatchStreak = 0;
        return;
      }
      // 暂时不一致：连续 2 次轮询仍失败才视为真顶号（避免瞬时抖动误杀）
      mismatchStreak += 1;
      if (mismatchStreak >= 2) {
        kick();
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    const unsubscribe = subscribeDeviceSessionGuard(userId, kick, portal);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [userId]);
}
