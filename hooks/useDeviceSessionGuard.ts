import { useEffect, useRef } from 'react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { isPasswordRecoveryMode } from '../utils/authRoutes';
import {
  DEVICE_KICKED_MESSAGE,
  clearLocalDeviceSession,
  subscribeDeviceSessionGuard,
  validateDeviceSession,
} from '../services/deviceSessionService';
import { signOut } from '../services/authService';

const POLL_INTERVAL_MS = 30_000;

let kickInProgress = false;

async function executeDeviceKick(): Promise<void> {
  if (kickInProgress) return;
  kickInProgress = true;
  try {
    clearLocalDeviceSession();
    await signOut({ removeDeviceRecord: false });
    window.alert(DEVICE_KICKED_MESSAGE);
    window.location.assign(window.location.pathname + window.location.search);
  } finally {
    kickInProgress = false;
  }
}

/**
 * 全局设备会话守卫：轮询 + Realtime，检测被顶号后强制下线。
 */
export function useDeviceSessionGuard(
  userId: string | undefined,
  onKicked?: () => void
): void {
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

  useEffect(() => {
    if (!isSupabaseConfigured() || !userId || isPasswordRecoveryMode()) return;

    let stopped = false;

    const kick = () => {
      if (stopped) return;
      onKickedRef.current?.();
      void executeDeviceKick();
    };

    const check = async () => {
      if (stopped) return;
      const valid = await validateDeviceSession(userId);
      if (!valid) kick();
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    const unsubscribe = subscribeDeviceSessionGuard(userId, kick);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [userId]);
}
