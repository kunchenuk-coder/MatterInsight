import Replicate from "replicate";

// ---------------------------------------------------------------------------
// Inpaint provider — dual mode on Replicate (exactly ONE replicate.run per request)
//
// Mode A (reference): when a material image URL is present
//   Model: usamaehsan/controlnet-x-ip-adapter-realistic-vision-v5
//
// Mode B (text-only): when no material image
//   Model: black-forest-labs/flux-fill-pro
//
// IMPORTANT:
// - Never auto-fallback from Mode A → Mode B (that would create 2 predictions).
// - Never retry on 429.
// - One user click / one requestId = one replicate.run().
// ---------------------------------------------------------------------------

const FLUX_FILL_MODEL = "black-forest-labs/flux-fill-pro";

const REFERENCE_INPAINT_MODEL =
  "usamaehsan/controlnet-x-ip-adapter-realistic-vision-v5:50ac06bb9bcf30e7b5dc66d3fe6e67262059a11ade572a35afa0ef686f55db82";

const MATERIAL_IP_ADAPTER_CKPT = "ip-adapter-plus_sd15.bin";

const DEFAULT_PROMPT =
  "realistic interior material texture, highly detailed, photorealistic";

/** Process-local counter so we can prove one requestId ⇒ one run. */
let replicateRunCount = 0;

export interface InpaintProviderInput {
  originalImageUrl: string;
  maskImageBase64: string;
  materialPrompt: string;
  materialImageUrl?: string;
  /** Client-generated id; one click = one requestId = one replicate.run. */
  requestId?: string;
}

export interface InpaintProviderResult {
  imageUrl: string;
  provider: "replicate";
  mode: "reference" | "flux_fill";
  model: string;
  requestId: string;
  replicateRunIndex: number;
}

export type InpaintErrorKind =
  | "quota"
  | "rate_limit"
  | "unavailable"
  | "config"
  | "empty"
  | "other";

export class InpaintProviderError extends Error {
  provider: string;
  kind: InpaintErrorKind;

  constructor(provider: string, kind: InpaintErrorKind, message: string) {
    super(message);
    this.name = "InpaintProviderError";
    this.provider = provider;
    this.kind = kind;
  }
}

function buildPrompt(materialPrompt: string): string {
  const base = materialPrompt?.trim();
  if (!base) return DEFAULT_PROMPT;
  return [
    `replace the masked surface with this exact material: ${base}`,
    "preserve room layout, perspective, lighting, shadows and reflections",
    "photorealistic interior design material, seamless blend",
  ].join(", ");
}

function resolveReplicateOutput(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const firstString = output.find((entry) => typeof entry === "string");
    return typeof firstString === "string" ? firstString : null;
  }
  if (output && typeof output === "object") {
    const candidate = (output as { url?: unknown }).url;
    if (typeof candidate === "string") return candidate;
    if (typeof candidate === "function") {
      try {
        const resolved = (candidate as () => unknown).call(output);
        if (typeof resolved === "string") return resolved;
        if (resolved && typeof (resolved as URL).href === "string") {
          return (resolved as URL).href;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function extractStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const anyErr = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof anyErr.status === "number") return anyErr.status;
  if (anyErr.response && typeof anyErr.response.status === "number") {
    return anyErr.response.status;
  }
  return null;
}

function classifyReplicateError(error: unknown): InpaintProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatus(error);
  const lower = message.toLowerCase();

  if (status === 429 || /rate.?limit|too many requests|429/.test(lower)) {
    return new InpaintProviderError(
      "replicate",
      "rate_limit",
      "Replicate rate limited"
    );
  }
  if (
    status === 402 ||
    /quota|insufficient credit|billing|payment required|out of credit|spend limit|monthly budget/.test(
      lower
    )
  ) {
    return new InpaintProviderError("replicate", "quota", message);
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /unavailable|temporarily|timeout|timed out|econn|enotfound|network|fetch failed|socket hang up|service is down/.test(
      lower
    )
  ) {
    return new InpaintProviderError("replicate", "unavailable", message);
  }
  return new InpaintProviderError("replicate", "other", message);
}

function preview(value: string): string {
  if (value.length <= 120) return value;
  return `${value.slice(0, 80)}…(${value.length} chars)`;
}

function logInpaintRequest(params: {
  requestId: string;
  model: string;
  image: string;
  mask: string;
  materialImage: string | null;
  referenceMode: boolean;
  modelInput: Record<string, unknown>;
}): void {
  console.log("[inpaint] replicate.run: requestId:", params.requestId);
  console.log("[inpaint] model:", params.model);
  console.log("[inpaint] image:", preview(params.image));
  console.log("[inpaint] mask:", preview(params.mask));
  console.log(
    "[inpaint] material_image:",
    params.materialImage ? preview(params.materialImage) : null
  );
  console.log("[inpaint] reference_mode:", params.referenceMode);
  console.log("[inpaint] model_input_keys:", Object.keys(params.modelInput));
  console.log(
    "[inpaint] model_input_has_material:",
    Boolean(params.modelInput.ip_adapter_image)
  );
}

async function callReplicateOnce(
  replicate: Replicate,
  model: string,
  modelInput: Record<string, unknown>,
  requestId: string
): Promise<unknown> {
  replicateRunCount += 1;
  console.log("[inpaint] replicate.run START", {
    requestId,
    model,
    runIndex: replicateRunCount,
  });
  try {
    const output = await replicate.run(
      model as `${string}/${string}` | `${string}/${string}:${string}`,
      { input: modelInput }
    );
    console.log("[inpaint] replicate.run END", {
      requestId,
      runIndex: replicateRunCount,
    });
    return output;
  } catch (error) {
    // No retry — surface 429 immediately.
    throw classifyReplicateError(error);
  }
}

async function runReferenceInpaint(
  input: InpaintProviderInput,
  token: string,
  requestId: string
): Promise<InpaintProviderResult> {
  const materialImage = input.materialImageUrl?.trim();
  if (!materialImage) {
    throw new InpaintProviderError(
      "replicate",
      "other",
      "REFERENCE_MODE_REQUIRES_MATERIAL_IMAGE"
    );
  }

  const replicate = new Replicate({ auth: token });
  const prompt = buildPrompt(input.materialPrompt);

  const modelInput: Record<string, unknown> = {
    prompt,
    negative_prompt:
      "distorted geometry, extra furniture, warped lines, blurry texture, low detail, broken lighting, changed composition, cartoon, anime",
    inpainting_image: input.originalImageUrl,
    mask_image: input.maskImageBase64,
    ip_adapter_image: materialImage,
    ip_adapter_ckpt: MATERIAL_IP_ADAPTER_CKPT,
    ip_adapter_weight: 0.85,
    sorted_controlnets: "inpainting",
    inpainting_conditioning_scale: 1,
    inpainting_strength: 0.95,
    num_inference_steps: 30,
    guidance_scale: 7,
    num_outputs: 1,
    max_width: 1024,
    max_height: 1024,
    disable_safety_check: true,
  };

  logInpaintRequest({
    requestId,
    model: REFERENCE_INPAINT_MODEL,
    image: input.originalImageUrl,
    mask: input.maskImageBase64,
    materialImage,
    referenceMode: true,
    modelInput,
  });

  const output = await callReplicateOnce(
    replicate,
    REFERENCE_INPAINT_MODEL,
    modelInput,
    requestId
  );
  console.log("[inpaint] reference raw output =>", output);

  const imageUrl = resolveReplicateOutput(output);
  if (!imageUrl) {
    throw new InpaintProviderError("replicate", "empty", "REFERENCE_EMPTY_OUTPUT");
  }

  return {
    imageUrl,
    provider: "replicate",
    mode: "reference",
    model: REFERENCE_INPAINT_MODEL,
    requestId,
    replicateRunIndex: replicateRunCount,
  };
}

async function runFluxFillInpaint(
  input: InpaintProviderInput,
  token: string,
  requestId: string
): Promise<InpaintProviderResult> {
  const replicate = new Replicate({ auth: token });
  const prompt = buildPrompt(input.materialPrompt);

  // Official Flux Fill schema only — never inject materialImageUrl.
  const modelInput: Record<string, unknown> = {
    image: input.originalImageUrl,
    mask: input.maskImageBase64,
    prompt,
    steps: 50,
    guidance: 30,
  };

  logInpaintRequest({
    requestId,
    model: FLUX_FILL_MODEL,
    image: input.originalImageUrl,
    mask: input.maskImageBase64,
    materialImage: input.materialImageUrl?.trim() || null,
    referenceMode: false,
    modelInput,
  });

  const output = await callReplicateOnce(
    replicate,
    FLUX_FILL_MODEL,
    modelInput,
    requestId
  );
  console.log("[inpaint] flux-fill-pro raw output =>", output);

  const imageUrl = resolveReplicateOutput(output);
  if (!imageUrl) {
    throw new InpaintProviderError("replicate", "empty", "REPLICATE_EMPTY_OUTPUT");
  }

  return {
    imageUrl,
    provider: "replicate",
    mode: "flux_fill",
    model: FLUX_FILL_MODEL,
    requestId,
    replicateRunIndex: replicateRunCount,
  };
}

/**
 * Exactly ONE replicate.run per call.
 * - Has material image → Mode A only (no Flux fallback)
 * - No material image → Mode B only
 * - 429 → throw "Replicate rate limited" (no retry / no second model)
 */
export async function runInpaint(
  input: InpaintProviderInput,
  config: { replicateToken: string | null }
): Promise<InpaintProviderResult> {
  if (!config.replicateToken) {
    throw new InpaintProviderError(
      "replicate",
      "config",
      "REPLICATE_API_TOKEN is not configured."
    );
  }

  const requestId =
    input.requestId?.trim() ||
    `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const hasMaterialImage = Boolean(input.materialImageUrl?.trim());
  const mode = hasMaterialImage ? "reference" : "flux_fill";

  console.log("[inpaint] request start: requestId:", requestId);
  console.log("[inpaint] routing =>", {
    requestId,
    hasMaterialImage,
    mode,
    note: "single replicate.run — no auto-fallback",
  });

  if (hasMaterialImage) {
    return runReferenceInpaint(input, config.replicateToken, requestId);
  }
  return runFluxFillInpaint(input, config.replicateToken, requestId);
}

export async function runReplicateInpaint(
  input: InpaintProviderInput,
  token: string
): Promise<InpaintProviderResult> {
  return runInpaint(input, { replicateToken: token });
}
