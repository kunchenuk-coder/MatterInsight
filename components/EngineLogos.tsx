import React from "react";
import type { VisionProvider } from "../utils/visionModelPreference";

/** Google 四色 G 标识（无文字） */
export function GoogleLogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.432 32.662 29.16 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.108 0 9.792-1.951 13.319-5.137l-6.147-5.196C29.26 35.641 26.782 36 24 36c-5.148 0-9.408-3.318-10.973-7.875l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.147 5.196C37.048 39.056 44 34.388 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/** 阿里云简化标识（无文字） */
export function AliyunLogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="3" y="3" width="42" height="42" rx="11" fill="#FF6A00" />
      <path
        fill="white"
        fillOpacity={0.92}
        d="M12 31V17h6l7 9V17h6v14h-5.5v-8l-6.5 8H12zm22-6h6c0-5-4-9-9-9v5c2.5 0 4.5 2 4.5 4.5H34V25z"
      />
    </svg>
  );
}

type EngineIconToggleProps = {
  value: VisionProvider;
  onChange: (v: VisionProvider) => void;
  disabled?: boolean;
  className?: string;
};

/** 双引擎单选：仅 Logo */
export const EngineIconToggle: React.FC<EngineIconToggleProps> = ({
  value,
  onChange,
  disabled,
  className = "",
}) => {
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.03] p-1 ${className}`}
      role="radiogroup"
      aria-label="Vision engine"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "gemini"}
        disabled={disabled}
        onClick={() => onChange("gemini")}
        className={`rounded-full p-2 transition ${
          value === "gemini" ? "bg-white shadow-md ring-1 ring-black/10" : "opacity-45 hover:opacity-80"
        } disabled:opacity-30`}
      >
        <GoogleLogoMark className="h-6 w-6" />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "qwen"}
        disabled={disabled}
        onClick={() => onChange("qwen")}
        className={`rounded-full p-2 transition ${
          value === "qwen" ? "bg-white shadow-md ring-1 ring-black/10" : "opacity-45 hover:opacity-80"
        } disabled:opacity-30`}
      >
        <AliyunLogoMark className="h-6 w-6" />
      </button>
    </div>
  );
};
