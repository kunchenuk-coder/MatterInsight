import { GoogleGenerativeAI } from "@google/generative-ai";

/** 与 Gemini / 千问共用，保证解析与看板逻辑一致（最多 3 条：1 主材质 + 2 备选） */
export const MATERIAL_ANALYSIS_PROMPT =
  "你是室内美学专家。分析图片中可见的材质区域。" +
  "【硬性约束】最多只输出 3 个 JSON 对象，严禁输出第 4 个及更多：第 1 个为「主材质」，第 2、3 个为「备选花色/材质」（若图中不足 3 处则只输出实际条数）。" +
  "严格只输出 JSON 数组，不要 markdown。每个元素包含：" +
  '{"x":0-100的数字表示区域水平位置百分比,"y":0-100的数字表示垂直位置百分比,"main_name":"材质大类","parameter":"颜色或纹理描述","matched_material_id":"可选，若无法确定则省略"}。' +
  "坐标尽量指向材质所在区域中心。";

/** 默认 gemini-2.0-flash（v1beta 下 1.5-flash 易 404）；可通过 VITE_GEMINI_MODEL 覆盖 */
const GEMINI_MODEL = (() => {
  const m = import.meta.env?.VITE_GEMINI_MODEL;
  if (m && String(m).trim()) return String(m).trim();
  return "gemini-2.0-flash";
})();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const GEMINI_RETRY_DELAYS_MS = [1200, 2800, 5200, 9000];
const QWEN_RETRY_DELAYS_MS = [900, 2200, 4000];

/** 429 / 配额 / 限流 */
export function isVisionRateLimitError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  const s = m.toLowerCase();
  if (/\b429\b/.test(m)) return true;
  if (s.includes("resource exhausted") || s.includes("resource_exhausted")) return true;
  if (s.includes("rate limit") || s.includes("ratelimit") || s.includes("too many requests")) return true;
  if (s.includes("quota") || s.includes("exceeded your current quota")) return true;
  if (m.includes("QWEN_HTTP_429")) return true;
  return false;
}
const QWEN_CHAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/** 仅允许 DashScope 视觉对话模型；默认 qwen-image-edit-plus，可用 VITE_QWEN_VISION_MODEL 覆盖；严禁 wanx / 视频类 */
export function getQwenVisionModelName(): string {
  const raw = import.meta.env.VITE_QWEN_VISION_MODEL;
  const m = (raw && String(raw).trim()) || "qwen-image-edit-plus";
  const lower = m.toLowerCase();
  if (lower.includes("wanx") || lower.includes("wan-x")) {
    throw new Error("已禁止 wanx 系列模型，请改用 VITE_QWEN_VISION_MODEL 指定视觉对话模型（如 qwen-image-edit-plus）");
  }
  if (lower.includes("video") || lower.includes("tts") || lower.includes("audio")) {
    throw new Error("已禁止非视觉对话类模型，请检查 VITE_QWEN_VISION_MODEL");
  }
  return m;
}

const ANALYSIS_TIMEOUT_MS = 90_000;

export function getGeminiApiKey(): string | undefined {
  const viteKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (viteKey && String(viteKey).trim()) return String(viteKey).trim();
  const legacy =
    typeof process !== "undefined"
      ? (process as unknown as { env?: { GEMINI_API_KEY?: string } }).env?.GEMINI_API_KEY
      : undefined;
  if (legacy && String(legacy).trim()) return String(legacy).trim();
  return undefined;
}

export function getQwenApiKey(): string | undefined {
  const k = import.meta.env.VITE_QWEN_API_KEY;
  return k && String(k).trim() ? String(k).trim() : undefined;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => {
      reject(new Error(`${label}_TIMEOUT`));
    }, ms);
    promise
      .then((v) => {
        window.clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        window.clearTimeout(id);
        reject(e);
      });
  });
}

/**
 * 仅在「网络/超时/服务端不可用」时降级千问。
 * 注意：不要用宽泛的 "fetch" 匹配 —— GoogleGenerativeAIFetchError 在 404 时也会带 fetch 字样。
 */
export function shouldFallbackToQwen(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  const s = m.toLowerCase();

  /** 模型名 / API 版本不匹配等 404 → 改试千问 */
  if (/\b404\b/.test(m) && (s.includes("not found") || s.includes("is not found") || s.includes("models/"))) {
    return true;
  }
  if (s.includes("invalid api key") || s.includes("api key not valid")) return false;

  /** 配额用尽 / 限流 → 优先尝试千问（与「网络不可用」并列降级场景） */
  if (/\b429\b/.test(m)) return true;
  if (s.includes("quota") || s.includes("resource exhausted") || s.includes("resource_exhausted"))
    return true;
  if (s.includes("rate limit") || s.includes("ratelimit") || s.includes("too many requests"))
    return true;
  if (s.includes("exceeded your current quota")) return true;

  if (s.includes("_timeout")) return true;
  if (s.includes("aborterror") || (s.includes("abort") && s.includes("signal"))) return true;
  if (s.includes("failed to fetch")) return true;
  if (s.includes("networkerror")) return true;
  if (s.includes("load failed")) return true;
  if (s.includes("econnrefused")) return true;
  if (s.includes("enotfound") && s.includes("getaddrinfo")) return true;
  if (s.includes("socket hang up")) return true;
  if (s.includes("net::err")) return true;
  if (s.includes("etimedout") || s.includes("timeout")) return true;
  if (/\b502\b|\b503\b|\b504\b/.test(m)) return true;
  return false;
}

export function parseMaterialAnalysisText(text: string): unknown[] {
  const stripped = text.replace(/```json|```/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\[[\s\S]*\]/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      const objMatch = stripped.match(/\{[\s\S]*\}/);
      if (objMatch) {
        parsed = JSON.parse(objMatch[0]);
      } else {
        throw new Error("INVALID_JSON_FROM_MODEL");
      }
    }
  }
  return Array.isArray(parsed) ? parsed.slice(0, 3) : [parsed];
}

export async function analyzeWithGemini(
  apiKey: string,
  prompt: string,
  base64: string,
  mimeType: string,
  opts?: { onRateLimitWait?: (attempt: number, delayMs: number) => void }
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
    const run = (async () => {
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType } },
      ]);
      const response = await result.response;
      return response.text();
    })();
    try {
      return await withTimeout(run, ANALYSIS_TIMEOUT_MS, "GEMINI");
    } catch (e) {
      lastErr = e;
      if (attempt >= GEMINI_RETRY_DELAYS_MS.length || !isVisionRateLimitError(e)) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      const delay = GEMINI_RETRY_DELAYS_MS[attempt]!;
      opts?.onRateLimitWait?.(attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function normalizeQwenMessageContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part: { text?: string }) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

/**
 * 使用阿里云 DashScope 兼容模式（需 VITE_QWEN_API_KEY）。
 * dataUrl 须为完整 data:image/...;base64,... 或纯 base64（将按 jpeg 包装）
 */
export async function analyzeWithQwen(
  apiKey: string,
  dataUrlOrBase64: string,
  prompt: string,
  opts?: { onRateLimitWait?: (attempt: number, delayMs: number) => void }
): Promise<string> {
  const imageUrl = dataUrlOrBase64.startsWith("data:")
    ? dataUrlOrBase64
    : `data:image/jpeg;base64,${dataUrlOrBase64}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= QWEN_RETRY_DELAYS_MS.length; attempt++) {
    const run = (async () => {
      const res = await fetch(QWEN_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getQwenVisionModelName(),
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`QWEN_HTTP_${res.status}: ${t}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const raw = data.choices?.[0]?.message?.content;
      const text = normalizeQwenMessageContent(raw);
      if (!text.trim()) {
        throw new Error("QWEN_EMPTY_RESPONSE");
      }
      return text;
    })();

    try {
      return await withTimeout(run, ANALYSIS_TIMEOUT_MS, "QWEN");
    } catch (e) {
      lastErr = e;
      const retryable = isVisionRateLimitError(e);
      if (attempt >= QWEN_RETRY_DELAYS_MS.length || !retryable) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      const delay = QWEN_RETRY_DELAYS_MS[attempt]!;
      opts?.onRateLimitWait?.(attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
