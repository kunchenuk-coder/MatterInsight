import React, { useState } from "react";
import type { UserRole } from "../types";
import { AliyunLogoMark, GoogleLogoMark } from "./EngineLogos";
import { getVisionProvider } from "../utils/visionModelPreference";

const PACK_POINTS = 50;
const PACK_CALLS = 10;

type VisionPaywallModalProps = {
  isOpen: boolean;
  onClose: () => void;
  role: UserRole;
  points: number;
  remainingDisplay: number;
  onPurchasePack: () => void;
  onOpenRecharge: () => void;
};

const VisionPaywallModal: React.FC<VisionPaywallModalProps> = ({
  isOpen,
  onClose,
  role,
  points,
  remainingDisplay,
  onPurchasePack,
  onOpenRecharge,
}) => {
  const [tab, setTab] = useState<"pack" | "recharge">("pack");
  if (!isOpen) return null;

  const engine = getVisionProvider();
  const isDesigner = role === "DESIGNER";

  return (
    <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/75 p-6 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-zinc-950 p-8 shadow-2xl">
        <div className="flex justify-center">
          {engine === "gemini" ? (
            <GoogleLogoMark className="h-12 w-12" />
          ) : (
            <AliyunLogoMark className="h-12 w-12" />
          )}
        </div>
        <p className="mt-6 text-center font-mono text-sm text-white/90">
          剩余额度: {remainingDisplay}
        </p>

        {isDesigner ? (
          <div className="mt-6">
            <div className="flex rounded-2xl bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setTab("pack")}
                className={`flex-1 rounded-xl py-3 text-xs font-black transition ${
                  tab === "pack" ? "bg-white text-black" : "text-white/50"
                }`}
              >
                {PACK_POINTS} 分 · {PACK_CALLS} 次
              </button>
              <button
                type="button"
                onClick={() => setTab("recharge")}
                className={`flex-1 rounded-xl py-3 text-xs font-black transition ${
                  tab === "recharge" ? "bg-white text-black" : "text-white/50"
                }`}
              >
                充值
              </button>
            </div>
            <div className="mt-4">
              {tab === "pack" ? (
                <button
                  type="button"
                  disabled={points < PACK_POINTS}
                  onClick={() => {
                    onPurchasePack();
                    onClose();
                  }}
                  className="w-full rounded-2xl bg-white py-4 text-xs font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
                >
                  购买
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onOpenRecharge();
                    onClose();
                  }}
                  className="w-full rounded-2xl border border-white/20 py-4 text-xs font-black text-white transition hover:bg-white/10"
                >
                  去充值
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-6 text-center text-sm text-white/50">联系运营开通额度</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-8 w-full text-center text-xs font-bold text-white/35 transition hover:text-white/60"
        >
          取消
        </button>
      </div>
    </div>
  );
};

export default VisionPaywallModal;
export { PACK_POINTS, PACK_CALLS };
