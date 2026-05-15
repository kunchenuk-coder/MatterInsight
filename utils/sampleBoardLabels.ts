import {
  analyzeWithVisionProviderChain,
  getGeminiApiKey,
  getQwenApiKey,
  getDeepSeekApiKey,
  getDeepSeekVisionModelName,
  parseMaterialAnalysisText,
} from "./aiMaterialAnalysis";

const LABEL_PROMPT =
  "这是一张材料样板图底部的色号/编号区域（可能含多行多列文字）。请按从左到右、从上到下的阅读顺序（先行后列），" +
  "识别出与上方色块矩阵一一对应的文本标签。严格只输出 JSON 字符串数组，例如 [\"RAL7016\",\"#BB1D34\",\"色号A\"]，" +
  "不要 markdown，不要解释。若某格无法识别，用空字符串 \"\" 占位。数组长度必须等于我随后给出的 total 值。";

/**
 * 使用视觉模型识别底部色号条，返回与色块 row-major 对齐的字符串列表。
 * 若 AI 不可用或解析失败，返回 null。
 */
export async function recognizeSampleLabels(
  stripJpegDataUrl: string,
  totalCells: number
): Promise<string[] | null> {
  const geminiKey = getGeminiApiKey();
  const qwenKey = getQwenApiKey();
  const dsKey = getDeepSeekApiKey();
  const dsModel = getDeepSeekVisionModelName();
  if (!geminiKey && !qwenKey && !(dsKey && dsModel)) return null;

  const mimeMatch = stripJpegDataUrl.match(/^data:(image\/[\w+.-]+);base64,/);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const base64Part = stripJpegDataUrl.includes(",")
    ? stripJpegDataUrl.split(",")[1]
    : stripJpegDataUrl;

  const prompt = `${LABEL_PROMPT}\ntotal=${totalCells}。`;

  try {
    const text = await analyzeWithVisionProviderChain(
      stripJpegDataUrl,
      prompt,
      base64Part,
      mimeType
    );

    const raw = parseMaterialAnalysisText(text);
    const arr = raw.filter((x): x is string => typeof x === "string");
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const out: string[] = [];
    for (let i = 0; i < totalCells; i++) {
      out.push(typeof arr[i] === "string" ? (arr[i] as string).trim() : "");
    }
    return out;
  } catch {
    return null;
  }
}

/** 解析用户粘贴的「每行一个色号」文本 */
export function parseManualLabelLines(text: string, totalCells: number): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < totalCells; i++) {
    out.push(lines[i] ?? "");
  }
  return out;
}
