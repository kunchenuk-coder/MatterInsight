/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  /** 默认 gemini-1.5-flash；可改为 gemini-1.5-pro 等 */
  readonly VITE_GEMINI_MODEL?: string;
  readonly VITE_QWEN_API_KEY?: string;
  /** DashScope 视觉对话模型，默认 qwen-image-edit-plus；禁止 wanx */
  readonly VITE_QWEN_VISION_MODEL?: string;
  /** 每用户免费视觉识别次数上限（本地计数，ADMIN 不限） */
  readonly VITE_VISION_FREE_LIMIT?: string;
  /** 可选：GET 返回 { remaining?: number } 与后端计费对齐 */
  readonly VITE_VISION_QUOTA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
