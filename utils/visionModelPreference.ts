/** 全局视觉 API 提供方（与情绪板 / 色卡识别共用，存 localStorage） */
export type VisionProvider = "gemini" | "qwen";

const STORAGE_KEY = "matter_insight_ai_model";

export function getVisionProvider(): VisionProvider {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "gemini" || v === "qwen") return v;
  } catch {
    /* ignore */
  }
  return "gemini";
}

export function setVisionProvider(p: VisionProvider): void {
  try {
    localStorage.setItem(STORAGE_KEY, p);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent("matter-vision-provider-change", { detail: p }));
  } catch {
    /* ignore */
  }
}
