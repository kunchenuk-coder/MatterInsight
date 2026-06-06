import React, { useCallback, useEffect, useRef, useState } from "react";
import { Category, MaterialVariant } from "../types";

type PublishFormState = {
  name: string;
  category: Category;
  brand: string;
  specifications: string;
  priceRange: string;
  stock: boolean;
  leadTime: string;
  fireRating: string;
  supplierNotes: string;
  image: string;
  variants: MaterialVariant[];
  projectPhotos: string[];
};

interface MaterialVoiceFillButtonProps {
  setFormData: React.Dispatch<React.SetStateAction<PublishFormState>>;
  disabled?: boolean;
  /** bar = PC 底栏长条；fab = 手机右下角悬浮球 */
  variant?: "bar" | "fab";
}

type SpeechApiFields = {
  name?: string;
  category?: string;
  price?: string;
  size?: string;
  remark?: string;
};

type SpeechApiResponse = {
  success: boolean;
  text?: string;
  fields?: SpeechApiFields;
  error?: string;
};

function resolveVoiceCategory(raw?: string): Category | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  const values = Object.values(Category) as string[];
  const exact = values.find((v) => v === t);
  if (exact) return exact as Category;
  const prefix = t.slice(0, 2).toUpperCase();
  const byPrefix = values.find((v) => v.startsWith(prefix));
  if (byPrefix) return byPrefix as Category;
  if (/石材|大理石|岩板|瓷砖/.test(t)) return Category.ST;
  if (/木|板材|地板/.test(t)) return Category.WD;
  if (/金属|不锈钢|铝/.test(t)) return Category.MT;
  if (/玻璃/.test(t)) return Category.GL;
  if (/水泥|微水泥/.test(t)) return Category.CO;
  if (/面料|布|皮革/.test(t)) return Category.FB;
  if (/地毯/.test(t)) return Category.CP;
  if (/本地|其他/.test(t)) return Category.Other;
  return Category.Other;
}

function fieldsToFormPatch(fields: SpeechApiFields): Partial<PublishFormState> {
  const patch: Partial<PublishFormState> = {};
  if (fields.name?.trim()) patch.name = fields.name.trim();
  const cat = resolveVoiceCategory(fields.category);
  if (cat) patch.category = cat;
  if (fields.price?.trim()) {
    const p = fields.price.trim().replace(/^¥+/, "");
    patch.priceRange = p.includes("¥") ? p : `¥${p}/㎡`;
  }
  if (fields.size?.trim()) patch.specifications = fields.size.trim();
  if (fields.remark?.trim()) patch.supplierNotes = fields.remark.trim();
  return patch;
}

const VOICE_TIP_STORAGE_KEY = "hasSeenVoiceTip";

const MicIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden
  >
    <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-1 4.07A7.002 7.002 0 0112 19a7.002 7.002 0 01-5-2.93V14h2v1.07A5 5 0 0012 17a5 5 0 004-1.93V14h2v1.07z" />
  </svg>
);

const MaterialVoiceFillButton: React.FC<MaterialVoiceFillButtonProps> = ({
  setFormData,
  disabled = false,
  variant = "bar",
}) => {
  const [phase, setPhase] = useState<"idle" | "recording" | "parsing">("idle");
  const [statusHint, setStatusHint] = useState("");
  const [showVoiceTip, setShowVoiceTip] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const holdActiveRef = useRef(false);
  const pointerDownRef = useRef(false);
  const mimeTypeRef = useRef("audio/webm");

  const releaseMedia = useCallback(() => {
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (variant !== "fab") return;
    try {
      if (!localStorage.getItem(VOICE_TIP_STORAGE_KEY)) {
        setShowVoiceTip(true);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [variant]);

  const dismissVoiceTip = useCallback(() => {
    try {
      localStorage.setItem(VOICE_TIP_STORAGE_KEY, "true");
    } catch {
      /* ignore */
    }
    setShowVoiceTip(false);
  }, []);

  useEffect(() => {
    return () => {
      holdActiveRef.current = false;
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      releaseMedia();
    };
  }, [releaseMedia]);

  const uploadAndFill = useCallback(
    async (blob: Blob) => {
      if (blob.size < 1) {
        alert("未录到有效音频，请按住按钮说话后再松开。");
        return;
      }

      setPhase("parsing");
      setStatusHint("AI 识别中…");

      try {
        const formData = new FormData();
        formData.append("audio", blob, `voice.${mimeTypeRef.current.includes("webm") ? "webm" : "wav"}`);

        const res = await fetch("/api/speech-to-text", {
          method: "POST",
          body: formData,
        });

        const data = (await res.json()) as SpeechApiResponse;

        if (!res.ok || !data.success) {
          throw new Error(data.error || `请求失败 (${res.status})`);
        }

        const fields = data.fields ?? {};
        const patch = fieldsToFormPatch(fields);

        if (Object.keys(patch).length === 0 && data.text?.trim()) {
          patch.name = data.text.trim();
        }

        if (Object.keys(patch).length === 0) {
          alert("未能从语音中识别出有效字段，请重试或手动填写。");
          return;
        }

        setFormData((prev) => ({ ...prev, ...patch }));
      } catch (err) {
        console.error("[VoiceMaterial]", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (/NotAllowedError|Permission denied/i.test(msg)) {
          alert("麦克风权限被拒绝，请在浏览器设置中允许访问麦克风。");
        } else if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
          alert(
            "无法连接语音识别服务。请确认已部署到 Vercel 或使用 vercel dev 启动本地 API，并检查网络。"
          );
        } else if (/您可手动填写表单/.test(msg)) {
          alert(msg);
        } else {
          alert(`AI 识别失败：${msg}。您仍可手动填写表单。`);
        }
      } finally {
        setPhase("idle");
        setStatusHint("");
      }
    },
    [setFormData]
  );

  const stopRecording = useCallback(() => {
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    pointerDownRef.current = false;

    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      releaseMedia();
      setPhase("idle");
      setStatusHint("");
      return;
    }

    rec.onstop = () => {
      const blob = new Blob(audioChunksRef.current, {
        type: mimeTypeRef.current || "audio/webm",
      });
      audioChunksRef.current = [];
      releaseMedia();
      void uploadAndFill(blob);
    };

    try {
      rec.stop();
    } catch {
      releaseMedia();
      setPhase("idle");
      setStatusHint("");
    }
  }, [releaseMedia, uploadAndFill]);

  const startRecording = useCallback(async () => {
    if (disabled || phase === "parsing" || pointerDownRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      alert("当前浏览器不支持麦克风录音，请使用 Chrome / Edge / Safari 较新版本。");
      return;
    }

    pointerDownRef.current = true;
    holdActiveRef.current = true;
    audioChunksRef.current = [];
    setStatusHint("录音中…");
    setPhase("recording");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
      const mimeType =
        preferred.find((t) => MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
      mimeTypeRef.current = mimeType.split(";")[0] ?? "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onerror = () => {
        holdActiveRef.current = false;
        pointerDownRef.current = false;
        releaseMedia();
        setPhase("idle");
        setStatusHint("");
        alert("录音出错，请重试。");
      };

      recorder.start();
    } catch (err) {
      holdActiveRef.current = false;
      pointerDownRef.current = false;
      releaseMedia();
      setPhase("idle");
      setStatusHint("");
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (/NotAllowedError|Permission denied/i.test(msg)) {
        alert("无法访问麦克风，请在浏览器中允许麦克风权限。");
      } else {
        alert("无法启动录音，请检查麦克风设备。");
      }
    }
  }, [disabled, phase, releaseMedia]);

  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      void startRecording();
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      stopRecording();
    },
    onPointerLeave: () => {
      if (pointerDownRef.current) stopRecording();
    },
    onPointerCancel: () => {
      stopRecording();
    },
  };

  const busy = phase === "parsing";
  const recording = phase === "recording";

  if (variant === "fab") {
    return (
      <div className="touch-none md:hidden">
        {showVoiceTip && (
          <>
            <div
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
              aria-hidden
              onClick={dismissVoiceTip}
            />
            <div
              className="fixed bottom-[5.75rem] right-4 left-4 z-[70] bg-black/80 text-white backdrop-blur-md rounded-xl p-5 shadow-2xl border border-white/10"
              role="dialog"
              aria-labelledby="voice-tip-title"
              aria-modal="true"
            >
              <h3 id="voice-tip-title" className="text-sm font-black tracking-tight mb-2">
                💡 语音录入规范提示
              </h3>
              <p className="text-xs text-white/80 leading-relaxed mb-3">
                请按照表格提示的单位和内容自然描述即可。
              </p>
              <div className="text-[11px] text-white/75 space-y-1.5 mb-4 bg-white/5 rounded-lg p-3 border border-white/5 leading-relaxed">
                <p className="font-bold text-white/90">
                  「材料名称 + 分类 + 价格区间 + 规格尺寸」
                </p>
                <p>
                  例如口述：「黑色大理石，石材，500到800元，尺寸1200乘以2400」
                </p>
                <p className="text-[10px] text-white/50 pt-0.5">
                  提示：规格直接说数字，系统将默认以毫米(mm)录入，无需特意说单位。
                </p>
              </div>
              <button
                type="button"
                onClick={dismissVoiceTip}
                className="w-full py-2.5 rounded-lg bg-white text-black text-xs font-black active:scale-[0.98] transition-transform"
              >
                知道了，开始录入
              </button>
              <div
                className="absolute -bottom-2 right-8 h-4 w-4 rotate-45 bg-black/80 border-r border-b border-white/10"
                aria-hidden
              />
            </div>
          </>
        )}
        <button
          type="button"
          disabled={disabled || busy}
          {...pointerHandlers}
          className={`fixed bottom-8 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-xl active:scale-95 transition-transform touch-none select-none ${
            recording ? "ring-4 ring-amber-400/50 scale-95" : ""
          } ${busy ? "opacity-70" : ""}`}
          aria-label="按住录音，松开后 AI 识别并填入表单"
          title={recording ? "松开结束" : "按住说话"}
        >
          {busy ? (
            <span className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <MicIcon className="h-6 w-6" />
          )}
        </button>
        {statusHint && recording && (
          <p className="fixed bottom-[5.25rem] right-4 left-4 z-50 text-center text-[10px] text-gray-600 bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg shadow line-clamp-2 pointer-events-none">
            {statusHint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="touch-none flex flex-col gap-2 min-w-0 flex-1 sm:max-w-md">
      <button
        type="button"
        disabled={disabled || busy}
        {...pointerHandlers}
        className={`relative flex items-center justify-center gap-3 w-full py-4 px-5 rounded-[20px] font-black text-sm tracking-wide transition-all select-none touch-none border ${
          recording
            ? "bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 text-amber-100 border-amber-400/40 shadow-[0_0_24px_rgba(251,191,36,0.25)] scale-[0.98]"
            : busy
              ? "bg-gray-100 text-gray-400 border-gray-200 cursor-wait"
              : "bg-gradient-to-r from-neutral-950 to-neutral-800 text-white border-neutral-700 shadow-xl shadow-black/25 hover:shadow-amber-900/20 active:scale-[0.98]"
        }`}
        aria-label="按住录音，松开后 AI 识别并填入表单"
      >
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full ${
            recording ? "bg-amber-400/20 animate-pulse" : "bg-white/10"
          }`}
        >
          {busy ? (
            <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <MicIcon />
          )}
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[13px] md:text-sm">
            {busy ? "AI 识别中…" : recording ? "松开结束录音" : "语音录入，AI识别"}
          </span>
          <span className="block text-[9px] font-bold opacity-60 mt-0.5">
            {recording ? statusHint || "正在录音…" : "按住说话 · 松手自动填表"}
          </span>
        </span>
      </button>
      {statusHint && recording && (
        <p className="text-[10px] text-gray-500 line-clamp-2 px-1">{statusHint}</p>
      )}
    </div>
  );
};

export default MaterialVoiceFillButton;
