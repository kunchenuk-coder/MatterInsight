import { useEffect, useRef } from 'react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { isPasswordRecoveryMode } from '../utils/authRoutes';
import { getAppPortal } from '../utils/appPortal';
import {
  DEVICE_KICKED_MESSAGE,
  clearLocalDeviceSession,
  subscribeDeviceSessionGuard,
  validateDeviceSession,
} from '../services/deviceSessionService';
import { signOut } from '../services/authService';

const POLL_INTERVAL_MS = 30_000;

let kickInProgress = false;

/**
 * 仅在「同用户 + 同类设备被明确顶号」时退出当前 portal。
 * 禁止因暂时不一致 / 跨 portal 干扰而清 session。
 */
async function executeDeviceKick(): Promise<void> {
  if (kickInProgress) return;
  kickInProgress = true;
  try {
    // signOut 只清当前 portal 的 auth storageKey + 当前 user 的 device key
    await signOut({ removeDeviceRecord: false });
    window.alert(DEVICE_KICKED_MESSAGE);
    window.location.assign(window.location.pathname + window.location.search);
  } finally {
    kickInProgress = false;
  }
}

/**
 * 全局设备会话守卫：轮询 + Realtime。
 * 查询失败 / 暂时不一致 → 不踢；仅明确顶号才退当前 portal。
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
      clearLocalDeviceSession(userId, portal);
      void executeDeviceKick();
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
