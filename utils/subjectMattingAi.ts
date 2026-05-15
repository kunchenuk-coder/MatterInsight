/**
 * 单张材料图：AI 估计主体包围盒 + 厂家编号 OCR（Gemini / 千问）
 */

import {
  analyzeWithVisionProviderChain,
  getGeminiApiKey,
  getQwenApiKey,
  getDeepSeekApiKey,
  getDeepSeekVisionModelName,
  parseMaterialAnalysisText,
} from "./aiMaterialAnalysis";

const BOX_PROMPT =
  "图中是材料小样实拍（可能有切割垫、手指、纸张等背景）。请只框出「材料样块」这一主体，不要包含大面积垫板或手指。" +
  "严格只输出一个 JSON 对象，不要 markdown：{\"x\":0-100,\"y\":0-100,\"w\":0-100,\"h\":0-100}，" +
  "x,y 为左上角相对整图宽高百分比，w,h 为主体宽高百分比。若无法判断，输出 {\"x\":22,\"y\":22,\"w\":56,\"h\":56}。";

const CODE_PROMPT =
  "图中是材料样块下方或紧邻区域的厂家编号、型号、货号等印刷文字。只输出一行识别结果字符串；若没有清晰文字输出 NONE。";

export type NormBBox = { x: number; y: number; w: number; h: number };

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function parseBBoxFromModelText(text: string): NormBBox | null {
  const stripped = text.replace(/```json|```/g, "").trim();
  const tryObj = (raw: unknown): NormBBox | null => {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const x = Number(o.x);
    const y = Number(o.y);
    const w = Number(o.w);
    const h = Number(o.h);
    if ([x, y, w, h].every((n) => Number.isFinite(n)) && w > 2 && h > 2) {
      return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
    }
    return null;
  };
  try {
    const obj = JSON.parse(stripped);
    const b = tryObj(obj);
    if (b) return b;
    if (Array.isArray(obj) && obj.length) {
      const b2 = tryObj(obj[0]);
      if (b2) return b2;
    }
  } catch {
    /* fall through */
  }
  try {
    const arr = parseMaterialAnalysisText(text);
    return tryObj(arr[0]);
  } catch {
    return null;
  }
}

export async function inferSubjectBoundingBoxNorm(imageDataUrl: string): Promise<NormBBox | null> {
  const geminiKey = getGeminiApiKey();
  const qwenKey = getQwenApiKey();
  const dsKey = getDeepSeekApiKey();
  const dsModel = getDeepSeekVisionModelName();
  if (!geminiKey && !qwenKey && !(dsKey && dsModel)) return null;

  const mimeMatch = imageDataUrl.match(/^data:(image\/[\w+.-]+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const base64Part = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;

  try {
    const text = await analyzeWithVisionProviderChain(
      imageDataUrl,
      BOX_PROMPT,
      base64Part,
      mimeType
    );
    return parseBBoxFromModelText(text);
  } catch {
    return null;
  }
}

/** 裁切归一化框下方一条区域做 OCR（jpeg data url） */
export async function cropStripBelowBoxDataUrl(
  imageDataUrl: string,
  box: NormBBox,
  stripHNorm = 0.14
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("load"));
    i.src = imageDataUrl;
  });
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const bx = (box.x / 100) * W;
  const by = (box.y / 100) * H;
  const bw = (box.w / 100) * W;
  const bh = (box.h / 100) * H;
  const sy = Math.min(H - 4, Math.max(0, by + bh - bh * 0.05));
  const sh = Math.min(H - sy, Math.max(24, stripHNorm * H));
  const sx = Math.max(0, bx - bw * 0.08);
  const sw = Math.min(W - sx, bw * 1.16);

  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw));
  c.height = Math.max(1, Math.round(sh));
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.92);
}

export async function recognizeManufacturerCode(stripJpegDataUrl: string): Promise<string | null> {
  const geminiKey = getGeminiApiKey();
  const qwenKey = getQwenApiKey();
  const dsKey = getDeepSeekApiKey();
  const dsModel = getDeepSeekVisionModelName();
  if (!geminiKey && !qwenKey && !(dsKey && dsModel)) return null;

  const mimeMatch = stripJpegDataUrl.match(/^data:(image\/[\w+.-]+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const base64Part = stripJpegDataUrl.includes(",") ? stripJpegDataUrl.split(",")[1] : stripJpegDataUrl;

  try {
    const text = await analyzeWithVisionProviderChain(
      stripJpegDataUrl,
      CODE_PROMPT,
      base64Part,
      mimeType
    );
    const t = text.replace(/```[\s\S]*?```/g, "").trim();
    if (!t || /^none$/i.test(t)) return null;
    return t.replace(/^["']|["']$/g, "").slice(0, 120);
  } catch {
    return null;
  }
}
