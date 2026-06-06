export const config = {
  runtime: "edge",
  maxDuration: 30,
};

const STRUCTURE_PROMPT = `你是一个建筑材料专家，请精准识别用户语音中的中英文混杂信息（例如：Black Marble, 1200x2400mm, Class A防火等级），并将其结构化为 JSON。

要求：
1. 准确转写原文，保留中英文混排（如 Black Marble、2400×1200mm、Class A 防火等级）。
2. 从语音中提取材料名称、分类、价格、规格、备注等字段。
3. 严格只返回 JSON，不要 Markdown 代码块或任何解释。

格式：
{"transcript":"完整转写原文","name":"材料名称","category":"材料分类(如 ST石材, WD木材, MT金属, GL玻璃, 其他)","price":"价格区间","size":"规格尺寸","remark":"备注或防火等级等"}

无法识别的字段请省略或留空字符串。`;

const USER_FACING_AI_ERROR = "AI识别失败，您可手动填写表单";
const TIMEOUT_MS = 30_000;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";

type SpeechFields = {
  transcript?: string;
  name?: string;
  category?: string;
  price?: string;
  size?: string;
  remark?: string;
};

function envKey(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}_TIMEOUT`)),
      TIMEOUT_MS
    );
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseModelJson(text: string): SpeechFields {
  const stripped = text.replace(/```json|```/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("INVALID_JSON_FROM_MODEL");
    parsed = JSON.parse(match[0]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON_SHAPE");
  }
  return parsed as SpeechFields;
}

function normalizeCategory(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  const upper = t.toUpperCase();
  if (/^(ST|WD|MT|GL|CO|FB|CP|CT|SF|PVC|L)/.test(upper)) return t;
  const lower = t.toLowerCase();
  if (/marble|stone|granite|岩板|石材|瓷砖|tile/.test(lower)) return "ST石材";
  if (/wood|timber|oak|木|板材|地板/.test(lower)) return "WD木材";
  if (/metal|steel|stainless|aluminum|不锈钢|金属/.test(lower)) return "MT金属";
  if (/glass|玻璃/.test(lower)) return "GL玻璃";
  if (/cement|concrete|水泥|微水泥/.test(lower)) return "CO水泥";
  if (/fabric|leather|布|皮革|面料/.test(lower)) return "FB面料";
  if (/carpet|地毯/.test(lower)) return "CP地毯";
  if (/其他|other|local/.test(lower)) return "其他";
  return t;
}

function normalizeFields(raw: SpeechFields): SpeechFields {
  return {
    transcript: raw.transcript?.trim(),
    name: raw.name?.trim(),
    category: normalizeCategory(raw.category),
    price: raw.price?.trim(),
    size: raw.size?.trim(),
    remark: raw.remark?.trim(),
  };
}

async function analyzeWithGemini(
  base64: string,
  mimeType: string
): Promise<SpeechFields> {
  const key = envKey("VITE_GEMINI_API_KEY", "GEMINI_API_KEY");
  if (!key) throw new Error("NO_GEMINI_KEY");

  const models = [
    envKey("VITE_GEMINI_MODEL", "GEMINI_MODEL") ?? "gemini-2.0-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
  ].filter((m, i, arr) => m && arr.indexOf(m) === i) as string[];

  let lastErr: unknown;
  for (const model of models) {
    try {
      const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const run = fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType, data: base64 } },
                { text: STRUCTURE_PROMPT },
              ],
            },
          ],
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`GEMINI_HTTP_${res.status}: ${t.slice(0, 400)}`);
        }
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!text) throw new Error("GEMINI_EMPTY");
        return normalizeFields(parseModelJson(text));
      });
      return await withTimeout(run, "GEMINI");
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b404\b/.test(msg) && /not found|models\//i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function analyzeWithDeepSeek(
  base64: string,
  mimeType: string
): Promise<SpeechFields> {
  const key = envKey("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");
  if (!key) throw new Error("NO_DEEPSEEK_KEY");

  const model =
    envKey("VITE_DEEPSEEK_CHAT_MODEL", "DEEPSEEK_CHAT_MODEL") ??
    "deepseek-chat";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const run = fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: dataUrl } },
            { type: "text", text: STRUCTURE_PROMPT },
          ],
        },
      ],
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`DEEPSEEK_HTTP_${res.status}: ${t.slice(0, 400)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("DEEPSEEK_EMPTY");
    return normalizeFields(parseModelJson(text));
  });

  return withTimeout(run, "DEEPSEEK");
}

async function transcribeAudio(
  base64: string,
  mimeType: string
): Promise<SpeechFields> {
  const geminiKey = envKey("VITE_GEMINI_API_KEY", "GEMINI_API_KEY");
  const dsKey = envKey("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");

  if (!geminiKey && !dsKey) {
    throw new Error("NO_PROVIDER_KEY");
  }

  const errors: string[] = [];

  if (geminiKey) {
    try {
      return await analyzeWithGemini(base64, mimeType);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      console.error("[speech-to-text] Gemini failed:", e);
    }
  }

  if (dsKey) {
    try {
      return await analyzeWithDeepSeek(base64, mimeType);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      console.error("[speech-to-text] DeepSeek failed:", e);
    }
  }

  throw new Error(errors.join(" | ") || "ALL_PROVIDERS_FAILED");
}

function buildResponse(fields: SpeechFields): {
  text: string;
  fields: SpeechFields;
} {
  const text =
    fields.transcript?.trim() ||
    [fields.name, fields.category, fields.price, fields.size, fields.remark]
      .filter(Boolean)
      .join("，");

  return {
    text,
    fields: {
      name: fields.name ?? "",
      category: fields.category ?? "",
      price: fields.price ?? "",
      size: fields.size ?? "",
      remark: fields.remark ?? "",
    },
  };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("audio");
    if (!file || !(file instanceof Blob)) {
      return new Response(
        JSON.stringify({ success: false, error: "缺少 audio 字段" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (file.size < 1) {
      return new Response(
        JSON.stringify({ success: false, error: "录音为空，请按住按钮说话" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const mimeType = file.type || "audio/webm";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = uint8ToBase64(bytes);

    const parsed = await transcribeAudio(base64, mimeType);
    const { text, fields } = buildResponse(parsed);

    if (!text.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: USER_FACING_AI_ERROR }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, text: text.trim(), fields }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[speech-to-text]", err);
    return new Response(
      JSON.stringify({ success: false, error: USER_FACING_AI_ERROR }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
