/**
 * 色卡样板：Gemini 视觉检测色块包围盒与厂家编码（0–1000 归一化坐标）
 */
import {
  analyzeWithGemini,
  analyzeWithQwen,
  getGeminiApiKey,
  getQwenApiKey,
  parseMaterialAnalysisText,
} from "../utils/aiMaterialAnalysis";
import { getVisionProvider, type VisionProvider } from "../utils/visionModelPreference";

const SWATCH_PROMPT =
  "你是印刷色卡/材料样块图的专业标注员。图中为规则排列的多个小色块（每块多为带颗粒或纹理的实体材料区域）。" +
  "任务：为「每一块可独立售卖的材料纹理本体」输出轴对齐包围盒，坐标必须紧贴纹理区域，不要松框。" +
  "\n\n【硬性约束】最多只输出 3 个色块对象（阅读顺序先上后下、同行从左到右取前 3 个），严禁输出第 4 个及更多。" +
  "\n\n严格要求：\n" +
  "1) box 只包住有色颗粒/纹理材料本身，尽量不包含：上方或旁边的印刷编号条、中文说明字（如运动场等）、色块之间的白缝/灰缝、相邻色块的边缘。\n" +
  "2) 若某块上方有一条窄的印刷标签带，请将 ymin 下移以排除该标签，仅保留下方主色纹理区。\n" +
  "3) xmin/xmax/ymin/ymax 为整图归一化坐标，范围 0–1000 的整数；左上为原点，x 向右、y 向下。\n" +
  "4) manufacturer_code：只写该块旁或块内可见的型号/色号短字符串；若无则写 NONE。\n" +
  "5) 严格只输出 JSON 数组，不要 markdown。元素格式：{\"box_2d\":[ymin,xmin,ymax,xmax],\"manufacturer_code\":\"...\"}\n" +
  "若无法识别则输出 []。";

export type SwatchDetection = {
  box_2d: [number, number, number, number];
  manufacturer_code: string;
};

/**
 * 将模型给出的 0–1000 归一化框内缩，裁掉常见外溢：印刷标签、缝线与邻块边缘。
 * 上沿多缩（标签多在上方），左右下略缩。
 */
export function tightenSwatchBox2d(
  box: [number, number, number, number],
  opts?: { topRatio?: number; sideRatio?: number; bottomRatio?: number }
): [number, number, number, number] {
  const topR = opts?.topRatio ?? 0.085;
  const sideR = opts?.sideRatio ?? 0.048;
  const botR = opts?.bottomRatio ?? 0.038;
  let [ymin, xmin, ymax, xmax] = box;
  const w = xmax - xmin;
  const h = ymax - ymin;
  if (w < 12 || h < 12) return box;

  const dx = w * sideR;
  const dyTop = h * topR;
  const dyBot = h * botR;

  xmin = Math.round(xmin + dx);
  xmax = Math.round(xmax - dx);
  ymin = Math.round(ymin + dyTop);
  ymax = Math.round(ymax - dyBot);

  xmin = Math.max(0, Math.min(1000, xmin));
  xmax = Math.max(0, Math.min(1000, xmax));
  ymin = Math.max(0, Math.min(1000, ymin));
  ymax = Math.max(0, Math.min(1000, ymax));

  if (xmax <= xmin + 8 || ymax <= ymin + 8) return box;
  return [ymin, xmin, ymax, xmax];
}

function parseSwatchesFromText(text: string): SwatchDetection[] {
  const stripped = text.replace(/```json|```/gi, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    try {
      raw = parseMaterialAnalysisText(text);
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: SwatchDetection[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const box = o.box_2d;
    const code = typeof o.manufacturer_code === "string" ? o.manufacturer_code : "NONE";
    if (!Array.isArray(box) || box.length !== 4) continue;
    const nums = box.map((n) => Number(n));
    if (!nums.every((n) => Number.isFinite(n))) continue;
    const ymin = Math.max(0, Math.min(1000, nums[0]));
    const xmin = Math.max(0, Math.min(1000, nums[1]));
    const ymax = Math.max(0, Math.min(1000, nums[2]));
    const xmax = Math.max(0, Math.min(1000, nums[3]));
    if (ymax <= ymin || xmax <= xmin) continue;
    const tightened = tightenSwatchBox2d([ymin, xmin, ymax, xmax]);
    out.push({
      box_2d: tightened,
      manufacturer_code: /^none$/i.test(code.trim()) ? "—" : code.trim().slice(0, 64),
    });
  }
  return out.slice(0, 3);
}

export async function detectSwatches(
  imageDataUrl: string,
  opts?: {
    provider?: VisionProvider;
    onRateLimitWait?: (attempt: number, delayMs: number) => void;
  }
): Promise<SwatchDetection[]> {
  const provider = opts?.provider ?? getVisionProvider();
  const geminiKey = getGeminiApiKey();
  const qwenKey = getQwenApiKey();
  if (provider === "gemini" && !geminiKey) {
    throw new Error("未配置 Gemini API Key（VITE_GEMINI_API_KEY）");
  }
  if (provider === "qwen" && !qwenKey) {
    throw new Error("未配置通义千问 API Key（VITE_QWEN_API_KEY）");
  }

  const mimeMatch = imageDataUrl.match(/^data:(image\/[\w+.-]+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const base64Part = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;

  try {
    let text: string;
    if (provider === "gemini") {
      text = await analyzeWithGemini(geminiKey!, SWATCH_PROMPT, base64Part, mimeType, {
        onRateLimitWait: opts?.onRateLimitWait,
      });
    } else {
      text = await analyzeWithQwen(qwenKey!, imageDataUrl, SWATCH_PROMPT, {
        onRateLimitWait: opts?.onRateLimitWait,
      });
    }
    return parseSwatchesFromText(text);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

const SUBJECT_BOX_PROMPT =
  "Find the dominant physical material swatch (one textured body). Output strict JSON only: {\"box_2d\":[ymin,xmin,ymax,xmax]} with integers 0-1000 normalized to full image (origin top-left). One object only. If no clear subject use {\"box_2d\":[120,120,880,880]}.";

const OCR_CODE_PROMPT =
  "Read manufacturer / model code printed near bottom of this crop. Output strict JSON only: {\"code\":\"TEXT\"} or {\"code\":\"NONE\"}.";

function parseSubjectBox(text: string): [number, number, number, number] | null {
  const stripped = text.replace(/```json|```/gi, "").trim();
  try {
    const o = JSON.parse(stripped) as { box_2d?: unknown };
    const b = o.box_2d;
    if (!Array.isArray(b) || b.length !== 4) return null;
    const n = b.map((x) => Number(x));
    if (!n.every((x) => Number.isFinite(x))) return null;
    return [n[0], n[1], n[2], n[3]] as [number, number, number, number];
  } catch {
    return null;
  }
}

/** Gemini：语义主体包围盒 0–1000 */
export async function detectSemanticSubjectBox(
  imageDataUrl: string,
  opts?: { onRateLimitWait?: (attempt: number, delayMs: number) => void }
): Promise<[number, number, number, number] | null> {
  const geminiKey = getGeminiApiKey();
  if (!geminiKey) throw new Error("未配置 Gemini API Key（VITE_GEMINI_API_KEY）");
  const mimeMatch = imageDataUrl.match(/^data:(image\/[\w+.-]+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const base64Part = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;
  const text = await analyzeWithGemini(geminiKey, SUBJECT_BOX_PROMPT, base64Part, mimeType, {
    onRateLimitWait: opts?.onRateLimitWait,
  });
  return parseSubjectBox(text);
}

function parseOcrCode(text: string): string | undefined {
  const stripped = text.replace(/```json|```/gi, "").trim();
  try {
    const o = JSON.parse(stripped) as { code?: unknown };
    const c = o.code;
    if (typeof c !== "string") return undefined;
    const t = c.trim();
    if (!t || /^none$/i.test(t)) return undefined;
    return t.slice(0, 64);
  } catch {
    return undefined;
  }
}

/** 底部条厂家编码 OCR（当前引擎） */
export async function readManufacturerCodeFromImageStrip(
  imageDataUrl: string,
  opts?: { provider?: VisionProvider; onRateLimitWait?: (attempt: number, delayMs: number) => void }
): Promise<string | undefined> {
  const provider = opts?.provider ?? getVisionProvider();
  const mimeMatch = imageDataUrl.match(/^data:(image\/[\w+.-]+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const base64Part = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;

  let text: string;
  if (provider === "gemini") {
    const k = getGeminiApiKey();
    if (!k) throw new Error("未配置 Gemini API Key");
    text = await analyzeWithGemini(k, OCR_CODE_PROMPT, base64Part, mimeType, {
      onRateLimitWait: opts?.onRateLimitWait,
    });
  } else {
    const k = getQwenApiKey();
    if (!k) throw new Error("未配置通义 Key");
    text = await analyzeWithQwen(k, imageDataUrl, OCR_CODE_PROMPT, {
      onRateLimitWait: opts?.onRateLimitWait,
    });
  }
  return parseOcrCode(text);
}
