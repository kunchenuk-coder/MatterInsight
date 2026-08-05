import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { InpaintProviderError, runInpaint } from "./aiInpaintProvider.js";
import {
  AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE,
  isAiMaterialReplacementEnabled,
} from "../utils/featureFlags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

interface InpaintRequestBody {
  original_image_url?: string;
  mask_image_base64?: string;
  material_prompt?: string;
  material_image_url?: string;
  request_id?: string;
}

interface InpaintSuccessResponse {
  success: true;
  imageUrl: string;
}

interface InpaintErrorResponse {
  success: false;
  error: string;
  message?: string;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: InpaintSuccessResponse | InpaintErrorResponse
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function refreshEnv(): void {
  const mode = process.env.NODE_ENV === "production" ? "production" : "development";
  const env = loadEnv(mode, PROJECT_ROOT, "");
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }
}

function getEnv(name: string): string | null {
  refreshEnv();
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export async function handleInpaintRequest(
  req: IncomingMessage & { method?: string },
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  // Feature flag: default OFF — never hit Replicate when disabled.
  refreshEnv();
  if (!isAiMaterialReplacementEnabled()) {
    console.log("[inpaint] blocked: ENABLE_AI_MATERIAL_REPLACEMENT is not true");
    sendJson(res, 503, {
      success: false,
      error: AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE,
      message: AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE,
    });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { success: false, error: "INVALID_JSON" });
    return;
  }

  const body = payload as InpaintRequestBody;
  const originalImageUrl =
    typeof body.original_image_url === "string" ? body.original_image_url.trim() : "";
  const maskImageBase64 =
    typeof body.mask_image_base64 === "string" ? body.mask_image_base64.trim() : "";
  const materialPrompt =
    typeof body.material_prompt === "string" ? body.material_prompt.trim() : "";
  const materialImageUrl =
    typeof body.material_image_url === "string" ? body.material_image_url.trim() : "";
  const requestId =
    typeof body.request_id === "string" && body.request_id.trim()
      ? body.request_id.trim()
      : `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  console.log("[inpaint] received: requestId:", requestId);

  if (!originalImageUrl || !maskImageBase64 || !materialPrompt) {
    sendJson(res, 400, { success: false, error: "MISSING_REQUIRED_FIELDS" });
    return;
  }

  const replicateToken = getEnv("REPLICATE_API_TOKEN");
  if (!replicateToken) {
    sendJson(res, 500, {
      success: false,
      error: "REPLICATE_API_TOKEN is not configured",
    });
    return;
  }

  try {
    const result = await runInpaint(
      {
        originalImageUrl,
        maskImageBase64,
        materialPrompt,
        materialImageUrl,
        requestId,
      },
      { replicateToken }
    );
    console.log(
      `[inpaint] served requestId=${result.requestId} mode=${result.mode} runIndex=${result.replicateRunIndex} model=${result.model}`
    );
    sendJson(res, 200, { success: true, imageUrl: result.imageUrl });
  } catch (error) {
    if (error instanceof InpaintProviderError && error.kind === "rate_limit") {
      console.error("[inpaint] rate limited requestId:", requestId);
      sendJson(res, 429, { success: false, error: "Replicate rate limited" });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[inpaint] requestId:", requestId, message);
    sendJson(res, 502, { success: false, error: message });
  }
}

export function createInpaintMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/inpaint")) {
      next();
      return;
    }
    void handleInpaintRequest(req, res);
  };
}
