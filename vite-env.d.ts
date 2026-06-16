/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  /** 默认 gemini-2.5-flash（与 aiMaterialAnalysis 内 404 换试链一致）；可改为账号可用的其他模型名 */
  readonly VITE_GEMINI_MODEL?: string;
  readonly VITE_QWEN_API_KEY?: string;
  /** DashScope 视觉对话模型，默认 qwen-image-edit-plus；禁止 wanx */
  readonly VITE_QWEN_VISION_MODEL?: string;
  /** DeepSeek 视觉降级（OpenAI 兼容接口）；与 VITE_DEEPSEEK_VISION_MODEL 同时配置才启用 */
  readonly VITE_DEEPSEEK_API_KEY?: string;
  /** 例如支持多模态的 DeepSeek 视觉模型名（以官方文档为准） */
  readonly VITE_DEEPSEEK_VISION_MODEL?: string;
  /** 纯文本对话模型（语音填表等），默认 deepseek-chat */
  readonly VITE_DEEPSEEK_CHAT_MODEL?: string;
  /** 纯文本对话模型（语音填表降级），默认 qwen-turbo */
  readonly VITE_QWEN_CHAT_MODEL?: string;
  /** 每用户免费视觉识别次数上限（本地计数，ADMIN 不限） */
  readonly VITE_VISION_FREE_LIMIT?: string;
  /** 可选：GET 返回 { remaining?: number } 与后端计费对齐 */
  readonly VITE_VISION_QUOTA_URL?: string;
  /** Supabase 项目 URL */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase 匿名公钥（publishable / anon key） */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
