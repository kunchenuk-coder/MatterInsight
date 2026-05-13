/**
 * 视觉识别免费额度与付费次数（本地 + 可选后端）。
 * 后端：VITE_VISION_QUOTA_URL（GET ?userId= → JSON { remainingFree, freeLimit, bonusPaidCalls }）。
 */

import type { UserRole } from "../types";

export type VisionQuotaSnapshot = {
  remainingFree: number;
  freeLimit: number;
  bonusPaidCalls: number;
  /** 已成功调用次数（含已用尽的免费段） */
  totalCalls: number;
};

function callsKey(userId: string) {
  return `matter_vision_calls_${userId}`;
}
function bonusKey(userId: string) {
  return `matter_vision_bonus_${userId}`;
}

function readLocal(userId: string): VisionQuotaSnapshot {
  const freeLimit = Math.max(
    0,
    parseInt(String(import.meta.env.VITE_VISION_FREE_LIMIT || "8"), 10) || 8
  );
  const totalCalls = Math.max(0, parseInt(localStorage.getItem(callsKey(userId)) || "0", 10) || 0);
  const bonusPaidCalls = Math.max(0, parseInt(localStorage.getItem(bonusKey(userId)) || "0", 10) || 0);
  const remainingFree = Math.max(0, freeLimit - totalCalls);
  return { remainingFree, freeLimit, bonusPaidCalls, totalCalls };
}

export async function refreshVisionQuota(userId: string): Promise<VisionQuotaSnapshot> {
  const url = import.meta.env.VITE_VISION_QUOTA_URL;
  if (url && String(url).trim()) {
    try {
      const r = await fetch(`${String(url).replace(/\/$/, "")}?userId=${encodeURIComponent(userId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        const j = (await r.json()) as Partial<VisionQuotaSnapshot>;
        if (
          typeof j.remainingFree === "number" &&
          typeof j.freeLimit === "number" &&
          typeof j.bonusPaidCalls === "number"
        ) {
          return {
            remainingFree: j.remainingFree,
            freeLimit: j.freeLimit,
            bonusPaidCalls: j.bonusPaidCalls,
            totalCalls: Math.max(0, j.freeLimit - j.remainingFree),
          };
        }
      }
    } catch {
      /* 回退本地 */
    }
  }
  return readLocal(userId);
}

/** 当前还可发起的视觉调用次数（免费段 + 加油包） */
export function totalVisionSlotsRemaining(snap: VisionQuotaSnapshot): number {
  return Math.max(0, snap.remainingFree) + Math.max(0, snap.bonusPaidCalls);
}

export function canInvokeVision(role: UserRole, snap: VisionQuotaSnapshot): boolean {
  if (role === "ADMIN") return true;
  return totalVisionSlotsRemaining(snap) > 0;
}

export function consumeVisionSlot(userId: string, snapBefore: VisionQuotaSnapshot): void {
  if (snapBefore.remainingFree > 0) {
    const t = Math.max(0, parseInt(localStorage.getItem(callsKey(userId)) || "0", 10) || 0);
    localStorage.setItem(callsKey(userId), String(t + 1));
  } else if (snapBefore.bonusPaidCalls > 0) {
    const b = Math.max(0, parseInt(localStorage.getItem(bonusKey(userId)) || "0", 10) || 0);
    localStorage.setItem(bonusKey(userId), String(Math.max(0, b - 1)));
  }
}

export function grantVisionBonusCalls(userId: string, n: number): void {
  const b = Math.max(0, parseInt(localStorage.getItem(bonusKey(userId)) || "0", 10) || 0);
  localStorage.setItem(bonusKey(userId), String(b + Math.max(0, n)));
}
