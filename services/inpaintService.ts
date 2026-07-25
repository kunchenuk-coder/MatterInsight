import {
  AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE,
  isAiMaterialReplacementEnabled,
} from "../utils/featureFlags";

export interface InpaintRequestPayload {
  original_image_url: string;
  mask_image_base64: string;
  material_prompt: string;
  /** 选中材料的图片 URL（可选，透传到后端） */
  material_image_url?: string;
  /** 一次用户点击生成一个 id，用于服务端去重/追踪 */
  request_id?: string;
}

export interface InpaintSuccessResponse {
  success: true;
  imageUrl: string;
}

export interface InpaintErrorResponse {
  success: false;
  error: string;
  message?: string;
}

export type InpaintApiResponse = InpaintSuccessResponse | InpaintErrorResponse;

export function createInpaintRequestId(): string {
  return `inp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function requestInpaint(
  params: InpaintRequestPayload
): Promise<InpaintApiResponse> {
  // Client-side guard: do not call /api/inpaint when the feature flag is off.
  if (!isAiMaterialReplacementEnabled()) {
    return {
      success: false,
      error: AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE,
      message: AI_MATERIAL_REPLACEMENT_DISABLED_MESSAGE,
    };
  }

  const requestId = params.request_id || createInpaintRequestId();
  console.log("[inpaint] request start: requestId:", requestId);

  try {
    const res = await fetch("/api/inpaint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, request_id: requestId }),
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return { success: false, error: `HTTP_${res.status}_NON_JSON` };
    }

    const data = (await res.json()) as InpaintApiResponse;

    if (res.status === 429) {
      return { success: false, error: "Replicate rate limited" };
    }

    if (!res.ok) {
      return {
        success: false,
        error: "error" in data ? data.error : `HTTP_${res.status}`,
      };
    }

    return data;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
