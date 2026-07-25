/**
 * Feature flags. Default OFF unless explicitly set to "true".
 *
 * Server reads ENABLE_AI_MATERIAL_REPLACEMENT from process.env / .env.local.
 * Client reads the same value via Vite `define` → import.meta.env.VITE_ENABLE_AI_MATERIAL_REPLACEMENT
 * (vite.config mirrors ENABLE_AI_MATERIAL_REPLACEMENT so you only set one var).
 */

function parseFlag(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

/** AI 材质替换（Inpaint / Replicate）。默认关闭。 */
export function isAiMaterialReplacementEnabled(): boolean {
  // Browser (Vite)
  if (typeof import.meta !== "undefined" && import.meta.env) {
    const fromVite = (import.meta.env as Record<string, unknown>)
      .VITE_ENABLE_AI_MATERIAL_REPLACEMENT;
    if (fromVite !== undefined && fromVite !== "") {
      return parseFlag(fromVite);
    }
  }
  // Node / Vite middleware
  if (typeof process !== "undefined" && process.env) {
    return parseFlag(process.env.ENABLE_AI_MATERIAL_REPLACEMENT);
  }
  return false;
}

export const AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE =
  "AI material replacement disabled";

export const AI_MATERIAL_REPLACEMENT_COMING_SOON_LABEL =
  "AI智能材质替换功能即将上线";
