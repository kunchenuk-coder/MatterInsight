import { GoogleGenerativeAI } from "@google/generative-ai";

/** 所有带图视觉请求共用的 System 人格（Gemini systemInstruction / 千问与 DeepSeek 的 system 消息） */
export const VISION_INTERIOR_DESIGNER_SYSTEM_PROMPT =
  "你是一位拥有 15 年经验的高级室内设计师和材料专家。你的任务是精准识别图中指定坐标点的材料。请关注：\n" +
  "材质真实属性：分辨是大理石、岩板、金属还是木皮。\n" +
  "色彩纹理细节：例如「黑色大理石带白色根纹」，而非简单的「黑色石材」。\n" +
  "空间逻辑：结合上下文判断它是地面、墙面还是家具面。\n" +
  "材料库命名：输出中的材质称呼须带齐颜色/花色词（如「黑色大理石」「鱼肚白大理石」），勿只用「大理石」等泛称，以便与材料库条目对齐。\n" +
  "禁止错误：严禁将明显的深色/黑色材质识别为白色。";

/** 与 Gemini / 千问共用，保证解析与看板逻辑一致（最多 3 条：1 主材质 + 2 备选） */
export const MATERIAL_ANALYSIS_PROMPT =
  "你是室内美学专家。分析图片中可见的材质区域。" +
  "【硬性约束】最多只输出 3 个 JSON 对象，严禁输出第 4 个及更多：第 1 个为「主材质」，第 2、3 个为「备选花色/材质」（若图中不足 3 处则只输出实际条数）。" +
  "【材料库对齐】main_name 必须写成「颜色/花色 + 品类」的完整商业称呼（如「黑色大理石」「雅士白大理石」），禁止仅用「大理石」「石材」等泛称；若地面/台面为深黑、炭黑调，禁止写成「白色大理石」「爵士白」等浅色名称。" +
  "严格只输出 JSON 数组，不要 markdown。每个元素包含：" +
  '{"x":0-100的数字表示区域水平位置百分比,"y":0-100的数字表示垂直位置百分比,"main_name":"材质大类","parameter":"颜色或纹理描述","matched_material_id":"可选，若无法确定则省略"}。' +
  "matched_material_id 仅当能确定与某条已知库记录一致时填写；否则省略，但 main_name 与 parameter 必须与视觉一致以便系统按名称关联材料库。" +
  "坐标尽量指向材质所在区域中心。";

/** 深度识别：最多 10 条材质（面向付费档位） */
export const DEEP_MATERIAL_ANALYSIS_PROMPT =
  "你是室内美学专家。分析图片中可见的材质区域。" +
  "【硬性约束】最多只输出 10 个 JSON 对象，按视觉显著性排序：第 1 个为「主材质」，其余为局部/备选材质。" +
  "【材料库对齐】main_name 必须写成「颜色/花色 + 品类」的完整商业称呼，禁止泛称。" +
  "严格只输出 JSON 数组，不要 markdown。每个元素包含：" +
  '{"x":0-100的数字,"y":0-100的数字,"main_name":"材质大类","parameter":"颜色或纹理描述","matched_material_id":"可选"}。' +
  "坐标尽量指向材质所在区域中心。";

/** 仅附加在「千问」材质识别请求中的坐标与颜色约束（Gemini 仍用 MATERIAL_ANALYSIS_PROMPT） */
const QWEN_MATERIAL_VISION_APPENDIX =
  "【千问专属：像素落点与邻域颜色】\n" +
  "1) 每个 JSON 元素的 x、y 必须是 0–100 的百分比坐标，表示「材质纹理核心」在整幅图中的精确落点中心，而不是画面几何中心。\n" +
  "2) 请严格定位到该 (x,y) 落点：在想象中以该点为中心取原图上约 50×50 像素的邻域（按原图宽高映射百分比到像素），只依据该邻域内的像素判断主材质与颜色；忽略邻域外的环境色、天空反射、大面阴影溢色。\n" +
  "3) 若前置消息中给出「平均 RGB」且 R、G、B 三个通道均低于 80，则视为深色/近黑采样区：严禁 matched_material_id 或 main_name/parameter 指向白色、爵士白、鱼肚白、雪花白、雅士白等浅色系大理石或白墙涂料，除非邻域内确有浅色材质本体纹理。\n" +
  "4) 若邻域偏浅/高亮，亦勿将明显深色石材误判为浅灰涂料。\n" +
  "5) main_name 须含颜色/花色词（如「黑色大理石」），勿输出泛称「大理石」，以便与材料库名称精确匹配。\n" +
  "6) 若前置中出现英文 WARNING 行，必须视为最高优先级硬约束，不得违反。\n" +
  "以上约束与下列任务说明一并遵守。\n\n";

export type VisionSampleAnchor = {
  /** 0–100，相对原图宽高的百分比 */
  xPercent: number;
  yPercent: number;
  /** user：来自预览图点击；center：未点击时用几何中心 */
  source: "user" | "center";
};

/**
 * 以 anchor 对应原图像素为中心取约 50×50 邻域平均 RGB，生成千问前置颜色描述。
 */
export async function getAnchor50pxRgbHintForVision(
  dataUrl: string,
  anchor: VisionSampleAnchor
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w < 1 || h < 1) {
          resolve("");
          return;
        }
        const ax = Math.min(100, Math.max(0, anchor.xPercent));
        const ay = Math.min(100, Math.max(0, anchor.yPercent));
        const cx =
          anchor.source === "center"
            ? Math.floor(w / 2)
            : Math.min(w - 1, Math.max(0, Math.floor((ax / 100) * w)));
        const cy =
          anchor.source === "center"
            ? Math.floor(h / 2)
            : Math.min(h - 1, Math.max(0, Math.floor((ay / 100) * h)));
        const half = 25;
        const sx = Math.max(0, cx - half);
        const sy = Math.max(0, cy - half);
        const sw = Math.min(50, w - sx);
        const sh = Math.min(50, h - sy);
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const px = ctx.getImageData(0, 0, sw, sh).data;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let i = 0; i < px.length; i += 4) {
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
          n++;
        }
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let tone = "";
        if (lum < 55) tone = "整体偏深、接近黑色";
        else if (lum < 115) tone = "整体偏深灰或暗色";
        else if (lum < 175) tone = "中等明度（灰或中性色）";
        else if (lum < 235) tone = "偏浅、偏亮";
        else tone = "极浅或接近白色";
        const darkHard =
          r < 80 && g < 80 && b < 80
            ? "\n\nWARNING: The selected area is DARK/BLACK. Do NOT match any white or light-colored materials.\n"
            : "";
        const where =
          anchor.source === "user"
            ? `当前参考采样点对应原图约 (${ax.toFixed(1)}%, ${ay.toFixed(1)}%) 处（用户点击图片位置映射），以该点为中心`
            : "未点击图片时以画面几何中心为参考点，以该点为中心";
        resolve(
          `【物理颜色前置】${where}对约 50×50 像素邻域采样，平均 RGB≈(${r},${g},${b})，观感${tone}。请在该颜色范围内在库中匹配最接近的材质（尤其大理石/石材花色），并与上述坐标邻域约束一致。${darkHard}`
        );
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

export async function buildQwenMaterialUserPrompt(
  imageDataUrl: string,
  basePrompt: string,
  anchor?: VisionSampleAnchor
): Promise<string> {
  const a: VisionSampleAnchor = anchor ?? { xPercent: 50, yPercent: 50, source: "center" };
  const hint = await getAnchor50pxRgbHintForVision(imageDataUrl, a);
  return [hint, QWEN_MATERIAL_VISION_APPENDIX, basePrompt].filter((s) => s.trim().length > 0).join("\n");
}

/** 未设置 VITE_GEMINI_MODEL 时：优先与当前 Google AI Studio 可用模型对齐（旧版 gemini-1.5-* 裸名易 404） */
export const GEMINI_MODEL = (() => {
  const m = import.meta.env?.VITE_GEMINI_MODEL;
  if (m && String(m).trim()) return String(m).trim();
  return "gemini-2.5-flash";
})();

function dedupeModelNamesPreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Gemini 视觉模型试链：不同账号/地区可用的默认模型名不同，404 时在 analyzeWithGemini 内依次换试。
 * 勿依赖单一「gemini-1.5-flash」裸名（新账号常见 404）。
 */
function buildGeminiVisionModelTryList(): string[] {
  return dedupeModelNamesPreserveOrder([
    GEMINI_MODEL,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ]);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const GEMINI_RETRY_DELAYS_MS = [1200, 2800, 5200, 9000];
const QWEN_RETRY_DELAYS_MS = [900, 2200, 4000];
const DEEPSEEK_RETRY_DELAYS_MS = [900, 2200, 4000];

/** 429 / 配额 / 限流 */
export function isVisionRateLimitError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  const s = m.toLowerCase();
  if (/\b429\b/.test(m)) return true;
  if (s.includes("resource exhausted") || s.includes("resource_exhausted")) return true;
  if (s.includes("rate limit") || s.includes("ratelimit") || s.includes("too many requests")) return true;
  if (s.includes("quota") || s.includes("exceeded your current quota")) return true;
  if (m.includes("QWEN_HTTP_429")) return true;
  if (m.includes("DEEPSEEK_HTTP_429")) return true;
  return false;
}
const QWEN_CHAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";

/**
 * `@google/generative-ai` 使用的 Google Generative Language API 前缀。
 * 实际请求形如：`{BASE}/models/{modelId}:generateContent`（POST）。
 */
export const GEMINI_GENERATIVE_LANGUAGE_V1BETA_BASE =
  "https://generativelanguage.googleapis.com/v1beta";

/** 成功返回后打印，便于在浏览器 DevTools → Console 核对（纯前端不会出现在 `npm run dev` 终端）。 */
export function logVisionProviderSuccess(meta: {
  provider: string;
  baseUrl: string;
  modelId: string;
  endpointPattern?: string;
}): void {
  const pattern =
    meta.endpointPattern ??
    (meta.provider === "Gemini"
      ? `${GEMINI_GENERATIVE_LANGUAGE_V1BETA_BASE}/models/{modelId}:generateContent`
      : meta.baseUrl);
  console.info(
    `[AI][Vision] 本次请求成功 | provider=${meta.provider} | baseUrl=${meta.baseUrl} | modelId=${meta.modelId} | endpoint≈${pattern}`
  );
}

/** 仅允许 DashScope 视觉对话模型；默认 qwen-vl-plus，可用 VITE_QWEN_VISION_MODEL 覆盖；严禁 wanx / 视频类 */
export function getQwenVisionModelName(): string {
  const raw = import.meta.env.VITE_QWEN_VISION_MODEL;
  const m = (raw && String(raw).trim()) || "qwen-vl-plus";
  const lower = m.toLowerCase();
  if (lower.includes("wanx") || lower.includes("wan-x")) {
    throw new Error("已禁止 wanx 系列模型，请改用 VITE_QWEN_VISION_MODEL 指定视觉对话模型（如 qwen-vl-plus）");
  }
  if (lower.includes("video") || lower.includes("tts") || lower.includes("audio")) {
    throw new Error("已禁止非视觉对话类模型，请检查 VITE_QWEN_VISION_MODEL");
  }
  return m;
}

const ANALYSIS_TIMEOUT_MS = 90_000;

/** API 返回的 token 用量（若接口未返回则为 null，由 UI 展示估算值） */
export type VisionTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type VisionAnalysisResult = {
  text: string;
  provider: string;
  modelId: string;
  usage: VisionTokenUsage | null;
};

export function getAnalysisPromptForDepth(depth: 'basic' | 'deep'): string {
  return depth === 'deep' ? DEEP_MATERIAL_ANALYSIS_PROMPT : MATERIAL_ANALYSIS_PROMPT;
}

export function getGeminiApiKey(): string | undefined {
  const viteKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (viteKey && String(viteKey).trim()) return String(viteKey).trim();
  return undefined;
}

export function getQwenApiKey(): string | undefined {
  const k = import.meta.env.VITE_QWEN_API_KEY;
  return k && String(k).trim() ? String(k).trim() : undefined;
}

/** DeepSeek OpenAI 兼容接口（需与 VITE_DEEPSEEK_VISION_MODEL 同时配置才参与降级链） */
export function getDeepSeekApiKey(): string | undefined {
  const k = import.meta.env.VITE_DEEPSEEK_API_KEY;
  return k && String(k).trim() ? String(k).trim() : undefined;
}

/** 返回空字符串表示未配置，调用方应跳过 DeepSeek 视觉 */
export function getDeepSeekVisionModelName(): string {
  const raw = import.meta.env.VITE_DEEPSEEK_VISION_MODEL;
  return raw && String(raw).trim() ? String(raw).trim() : "";
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
  if (/\b500\b/.test(m)) return true;
  if (/\b502\b|\b503\b|\b504\b/.test(m)) return true;
  return false;
}

/** Gemini 返回「模型不存在 / 名称或 API 版本不匹配」类 404，用于同 Key 下换试备用模型名 */
function isGeminiModelNotFound404(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  const s = m.toLowerCase();
  return /\b404\b/.test(m) && (s.includes("not found") || s.includes("is not found") || s.includes("models/"));
}

/** Gemini 优先；失败时 DeepSeek（若已配置）→ 千问；人格与千问 RGB 前置保持一致 */
export async function analyzeWithVisionFallback(
  prompt: string,
  imageDataUrl: string,
  base64Part: string,
  mimeType: string,
  opts?: {
    onRateLimitWait?: (attempt: number, delayMs: number) => void;
    /** 千问 RGB 前置采样点（Gemini 路径下会拼入用户文案）；未传则几何中心 */
    sampleAnchor?: VisionSampleAnchor;
  }
): Promise<string> {
  const geminiKey = getGeminiApiKey();
  const qwenKey = getQwenApiKey();
  const dsKey = getDeepSeekApiKey();
  const dsModel = getDeepSeekVisionModelName();

  if (!geminiKey && !qwenKey && !(dsKey && dsModel)) {
    throw new Error("NO_VISION_API_KEY");
  }

  let geminiUserPrompt = prompt;
  if (opts?.sampleAnchor && imageDataUrl) {
    const hint = await getAnchor50pxRgbHintForVision(imageDataUrl, opts.sampleAnchor);
    if (hint.trim()) geminiUserPrompt = `${hint}\n\n${prompt}`;
  }

  if (geminiKey) {
    try {
      return (await analyzeWithGemini(geminiKey, geminiUserPrompt, base64Part, mimeType, opts)).text;
    } catch (gemErr) {
      if (!shouldFallbackToQwen(gemErr)) throw gemErr;
      const qwenPrompt = await buildQwenMaterialUserPrompt(imageDataUrl, prompt, opts?.sampleAnchor);
      if (dsKey && dsModel) {
        try {
          console.warn("[AI] Gemini 不可用，尝试 DeepSeek:", gemErr);
          return (await analyzeWithDeepSeekVision(dsKey, imageDataUrl, qwenPrompt, opts)).text;
        } catch (dsErr) {
          console.warn("[AI] DeepSeek 失败，切换千问:", dsErr);
        }
      }
      if (qwenKey) {
        console.warn("[AI] Gemini 不可用，已切换千问:", gemErr);
        return (await analyzeWithQwen(qwenKey, imageDataUrl, qwenPrompt, opts)).text;
      }
      throw gemErr;
    }
  }

  const qwenPrompt = await buildQwenMaterialUserPrompt(imageDataUrl, prompt, opts?.sampleAnchor);
  if (dsKey && dsModel) {
    try {
      return (await analyzeWithDeepSeekVision(dsKey, imageDataUrl, qwenPrompt, opts)).text;
    } catch (dsErr) {
      console.warn("[AI] DeepSeek 失败，切换千问:", dsErr);
    }
  }
  if (!qwenKey) throw new Error("NO_VISION_API_KEY");
  return (await analyzeWithQwen(qwenKey, imageDataUrl, qwenPrompt, opts)).text;
}

export function parseMaterialAnalysisText(text: string, maxItems = 3): unknown[] {
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
  return Array.isArray(parsed) ? parsed.slice(0, maxItems) : [parsed];
}

export async function analyzeWithGemini(
  apiKey: string,
  prompt: string,
  base64: string,
  mimeType: string,
  opts?: {
    onRateLimitWait?: (attempt: number, delayMs: number) => void;
    /** 不传则使用全局室内设计师 System Prompt */
    systemInstruction?: string;
  }
): Promise<VisionAnalysisResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const tryModelNames = buildGeminiVisionModelTryList();

  let lastErr: unknown;
  let usedModel = tryModelNames[0] ?? GEMINI_MODEL;
  for (let mi = 0; mi < tryModelNames.length; mi++) {
    const modelName = tryModelNames[mi]!;
    usedModel = modelName;
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: opts?.systemInstruction ?? VISION_INTERIOR_DESIGNER_SYSTEM_PROMPT,
    });
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
      const run = (async () => {
        const result = await model.generateContent([
          prompt,
          { inlineData: { data: base64, mimeType } },
        ]);
        const response = await result.response;
        const text = response.text();
        const meta = response.usageMetadata;
        const usage: VisionTokenUsage | null = meta
          ? {
              promptTokens: meta.promptTokenCount ?? 0,
              completionTokens: meta.candidatesTokenCount ?? 0,
              totalTokens: meta.totalTokenCount ?? 0,
            }
          : null;
        return { text, usage };
      })();
      try {
        const { text, usage } = await withTimeout(run, ANALYSIS_TIMEOUT_MS, "GEMINI");
        logVisionProviderSuccess({
          provider: "Gemini",
          baseUrl: GEMINI_GENERATIVE_LANGUAGE_V1BETA_BASE,
          modelId: modelName,
          endpointPattern: `${GEMINI_GENERATIVE_LANGUAGE_V1BETA_BASE}/models/${modelName}:generateContent`,
        });
        if (usage) {
          console.info(
            `[AI][Token] Gemini | in=${usage.promptTokens} out=${usage.completionTokens} total=${usage.totalTokens}`
          );
        }
        return { text, provider: "Gemini", modelId: modelName, usage };
      } catch (e) {
        lastErr = e;
        if (attempt < GEMINI_RETRY_DELAYS_MS.length && isVisionRateLimitError(e)) {
          const delay = GEMINI_RETRY_DELAYS_MS[attempt]!;
          opts?.onRateLimitWait?.(attempt + 1, delay);
          await sleep(delay);
          continue;
        }
        if (isGeminiModelNotFound404(e) && mi < tryModelNames.length - 1) {
          console.warn(`[AI] Gemini 模型「${modelName}」404/不可用，改试「${tryModelNames[mi + 1]}」`);
          break;
        }
        throw e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? `Gemini failed: ${usedModel}`));
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
  opts?: {
    onRateLimitWait?: (attempt: number, delayMs: number) => void;
    systemInstruction?: string;
  }
): Promise<VisionAnalysisResult> {
  const imageUrl = dataUrlOrBase64.startsWith("data:")
    ? dataUrlOrBase64
    : `data:image/jpeg;base64,${dataUrlOrBase64}`;

  const systemText = opts?.systemInstruction ?? VISION_INTERIOR_DESIGNER_SYSTEM_PROMPT;
  const modelId = getQwenVisionModelName();

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
          model: modelId,
          messages: [
            { role: "system", content: systemText },
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
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const raw = data.choices?.[0]?.message?.content;
      const text = normalizeQwenMessageContent(raw);
      if (!text.trim()) {
        throw new Error("QWEN_EMPTY_RESPONSE");
      }
      const u = data.usage;
      const usage: VisionTokenUsage | null = u
        ? {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
          }
        : null;
      return { text, usage };
    })();

    try {
      const { text, usage } = await withTimeout(run, ANALYSIS_TIMEOUT_MS, "QWEN");
      logVisionProviderSuccess({
        provider: "Qwen (DashScope OpenAI-compatible)",
        baseUrl: QWEN_CHAT_URL,
        modelId,
      });
      if (usage) {
        console.info(
          `[AI][Token] Qwen | in=${usage.promptTokens} out=${usage.completionTokens} total=${usage.totalTokens}`
        );
      }
      return { text, provider: "Qwen", modelId, usage };
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

/**
 * DeepSeek 多模态（OpenAI 兼容，需 VITE_DEEPSEEK_API_KEY + VITE_DEEPSEEK_VISION_MODEL）。
 * 若当前账号/模型不支持图片，调用方应捕获后降级千问。
 */
export async function analyzeWithDeepSeekVision(
  apiKey: string,
  dataUrlOrBase64: string,
  userPrompt: string,
  opts?: {
    onRateLimitWait?: (attempt: number, delayMs: number) => void;
    systemInstruction?: string;
  }
): Promise<VisionAnalysisResult> {
  const model = getDeepSeekVisionModelName();
  if (!model) {
    throw new Error("DEEPSEEK_VISION_MODEL_NOT_CONFIGURED");
  }
  const imageUrl = dataUrlOrBase64.startsWith("data:")
    ? dataUrlOrBase64
    : `data:image/jpeg;base64,${dataUrlOrBase64}`;
  const systemText = opts?.systemInstruction ?? VISION_INTERIOR_DESIGNER_SYSTEM_PROMPT;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= DEEPSEEK_RETRY_DELAYS_MS.length; attempt++) {
    const run = (async () => {
      const res = await fetch(DEEPSEEK_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemText },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl } },
                { type: "text", text: userPrompt },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`DEEPSEEK_HTTP_${res.status}: ${t}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const raw = data.choices?.[0]?.message?.content;
      const text = normalizeQwenMessageContent(raw);
      if (!text.trim()) {
        throw new Error("DEEPSEEK_EMPTY_RESPONSE");
      }
      const u = data.usage;
      const usage: VisionTokenUsage | null = u
        ? {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
          }
        : null;
      return { text, usage };
    })();

    try {
      const { text, usage } = await withTimeout(run, ANALYSIS_TIMEOUT_MS, "DEEPSEEK");
      logVisionProviderSuccess({
        provider: "DeepSeek (OpenAI-compatible)",
        baseUrl: DEEPSEEK_CHAT_URL,
        modelId: model,
      });
      if (usage) {
        console.info(
          `[AI][Token] DeepSeek | in=${usage.promptTokens} out=${usage.completionTokens} total=${usage.totalTokens}`
        );
      }
      return { text, provider: "DeepSeek", modelId: model, usage };
    } catch (e) {
      lastErr = e;
      const retryable = isVisionRateLimitError(e);
      if (attempt >= DEEPSEEK_RETRY_DELAYS_MS.length || !retryable) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      const delay = DEEPSEEK_RETRY_DELAYS_MS[attempt]!;
      opts?.onRateLimitWait?.(attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Gemini → DeepSeek（若已配置）→ 千问；与情绪板主链路降级顺序一致，供色卡/抠图等工具复用。
 */
export async function analyzeWithVisionProviderChain(
  imageDataUrl: string,
  userTextPrompt: string,
  base64Part: string,
  mimeType: string,
  opts?: { onRateLimitWait?: (attempt: number, delayMs: number) => void }
): Promise<string> {
  const geminiKey = getGeminiApiKey();
  const qwenKey = getQwenApiKey();
  const dsKey = getDeepSeekApiKey();
  const dsModel = getDeepSeekVisionModelName();

  if (!geminiKey && !qwenKey && !(dsKey && dsModel)) {
    throw new Error("NO_VISION_API_KEY");
  }

  if (geminiKey) {
    try {
      return (await analyzeWithGemini(geminiKey, userTextPrompt, base64Part, mimeType, opts)).text;
    } catch (e) {
      if (!shouldFallbackToQwen(e)) throw e;
      if (dsKey && dsModel) {
        try {
          console.warn("[AI] Gemini 不可用，尝试 DeepSeek:", e);
          return (await analyzeWithDeepSeekVision(dsKey, imageDataUrl, userTextPrompt, opts)).text;
        } catch (dsErr) {
          console.warn("[AI] DeepSeek 失败，切换千问:", dsErr);
        }
      }
      if (qwenKey) {
        return (await analyzeWithQwen(qwenKey, imageDataUrl, userTextPrompt, opts)).text;
      }
      throw e;
    }
  }

  if (dsKey && dsModel) {
    try {
      return (await analyzeWithDeepSeekVision(dsKey, imageDataUrl, userTextPrompt, opts)).text;
    } catch (dsErr) {
      console.warn("[AI] DeepSeek 失败，切换千问:", dsErr);
    }
  }
  if (!qwenKey) throw new Error("NO_VISION_API_KEY");
  return (await analyzeWithQwen(qwenKey, imageDataUrl, userTextPrompt, opts)).text;
}
