import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { loadEnv } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";
const GEMINI_REST_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type SpeechFields = {
  transcript?: string;
  name?: string;
  category?: string;
  price?: string;
  size?: string;
  remark?: string;
};

type MulterRequest = IncomingMessage & {
  file?: Express.Multer.File;
};

/** 每次请求前刷新 .env.local，避免 Vite 缓存旧占位符 */
function refreshEnv(): void {
  const mode = process.env.NODE_ENV === "production" ? "production" : "development";
  const env = loadEnv(mode, PROJECT_ROOT, "");
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
}

function sanitizeEnvValue(raw: string): string {
  let s = raw.replace(/^\uFEFF/, "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function isPlaceholderKey(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("your_") ||
    lower.endsWith("_here") ||
    lower === "placeholder" ||
    lower.includes("replace_me")
  );
}

function envKey(...names: string[]): string | undefined {
  refreshEnv();
  for (const n of names) {
    const v = process.env[n];
    if (!v) continue;
    const s = sanitizeEnvValue(String(v));
    if (!s || isPlaceholderKey(s)) {
      console.warn(`[speech-to-text] 环境变量 ${n} 疑似占位符，已跳过`);
      continue;
    }
    return s;
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

function bufferToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

function parseModelJson(text: string): SpeechFields {
  let cleanText = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleanText = jsonMatch[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanText);
  } catch (parseErr) {
    console.error("后端详细报错：JSON.parse 失败，原始文本=", text.slice(0, 500));
    throw parseErr;
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

async function analyzeWithGeminiSdk(
  base64: string,
  mimeType: string,
  apiKey: string
): Promise<SpeechFields> {
  const ai = new GoogleGenAI({ apiKey });
  const models = [
    envKey("VITE_GEMINI_MODEL", "GEMINI_MODEL") ?? "gemini-2.5-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ].filter((m, i, arr) => m && arr.indexOf(m) === i) as string[];

  let lastErr: unknown;
  for (const modelName of models) {
    try {
      const run = ai.models
        .generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType, data: base64 } },
                { text: STRUCTURE_PROMPT },
              ],
            },
          ],
        })
        .then((r) => {
          const raw = r.text?.trim() ?? "";
          if (!raw) throw new Error("GEMINI_EMPTY");
          return raw;
        });

      const rawText = await withTimeout(run, "GEMINI");
      try {
        return normalizeFields(parseModelJson(rawText));
      } catch (parseErr) {
        console.error("后端详细报错：Gemini SDK 返回 JSON 解析失败", parseErr);
        const dsKey = envKey("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");
        if (dsKey) {
          return structureWithDeepSeekText(rawText);
        }
        throw parseErr;
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b404\b/.test(msg) && /not found|models\//i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function analyzeWithGeminiRest(
  base64: string,
  mimeType: string,
  apiKey: string
): Promise<SpeechFields> {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let lastErr: unknown;

  for (const model of models) {
    try {
      const url = `${GEMINI_REST_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
          throw new Error(`GEMINI_REST_${res.status}: ${t.slice(0, 400)}`);
        }
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!raw) throw new Error("GEMINI_REST_EMPTY");
        return raw;
      });

      const rawText = await withTimeout(run, "GEMINI_REST");
      try {
        return normalizeFields(parseModelJson(rawText));
      } catch (parseErr) {
        console.error("后端详细报错：Gemini REST 返回 JSON 解析失败", parseErr);
        const dsKey = envKey("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");
        if (dsKey) {
          return structureWithDeepSeekText(rawText);
        }
        throw parseErr;
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b404\b/.test(msg) && /not found|models\//i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function analyzeWithGemini(
  base64: string,
  mimeType: string
): Promise<SpeechFields> {
  const key = envKey("VITE_GEMINI_API_KEY", "GEMINI_API_KEY");
  if (!key) throw new Error("NO_GEMINI_KEY");

  try {
    return await analyzeWithGeminiSdk(base64, mimeType, key);
  } catch (sdkErr) {
    console.error("后端详细报错：Gemini SDK 失败，尝试 REST 回退", sdkErr);
    return analyzeWithGeminiRest(base64, mimeType, key);
  }
}

/** DeepSeek 纯文本结构化（音频转写后的二次解析回退） */
async function structureWithDeepSeekText(transcript: string): Promise<SpeechFields> {
  const key = envKey("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY");
  if (!key) throw new Error("NO_DEEPSEEK_KEY");

  const model =
    envKey("VITE_DEEPSEEK_CHAT_MODEL", "DEEPSEEK_CHAT_MODEL") ??
    "deepseek-chat";

  const prompt = `${STRUCTURE_PROMPT}\n\n用户语音转写内容：\n${transcript}`;

  const run = fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`DEEPSEEK_HTTP_${res.status}: ${t.slice(0, 400)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("DEEPSEEK_EMPTY");
    return normalizeFields(parseModelJson(raw));
  });

  return withTimeout(run, "DEEPSEEK");
}

function hasEnvKey(...names: string[]): boolean {
  refreshEnv();
  for (const n of names) {
    const v = process.env[n];
    if (!v) continue;
    const s = sanitizeEnvValue(String(v));
    if (s && !isPlaceholderKey(s)) return true;
  }
  return false;
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
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Gemini: ${msg}`);
      console.error("后端详细报错：Gemini 全部尝试失败", e);
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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function createSpeechToTextMiddleware() {
  const singleUpload = upload.single("audio");

  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void
  ) => {
    const pathname = req.url?.split("?")[0];
    if (pathname !== "/api/speech-to-text") {
      return next();
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { success: false, error: "Method not allowed" });
      return;
    }

    singleUpload(req as MulterRequest, res, async (uploadErr: unknown) => {
      try {
        if (uploadErr) {
          throw uploadErr instanceof Error ? uploadErr : new Error(String(uploadErr));
        }

        refreshEnv();

        const file = (req as MulterRequest).file;
        if (!file?.buffer?.length) {
          sendJson(res, 400, {
            success: false,
            error: "缺少 audio 字段或录音为空",
          });
          return;
        }

        const mimeType = (file.mimetype || "audio/webm").split(";")[0]!;
        const base64 = bufferToBase64(file.buffer);

        console.info(
          `[speech-to-text] 收到音频 ${file.size} bytes, mime=${mimeType}, geminiKey=${hasEnvKey("VITE_GEMINI_API_KEY", "GEMINI_API_KEY")}, deepseekKey=${hasEnvKey("VITE_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY")}`
        );

        const parsed = await transcribeAudio(base64, mimeType);
        const { text, fields } = buildResponse(parsed);

        if (!text.trim()) {
          sendJson(res, 422, {
            success: false,
            error: USER_FACING_AI_ERROR,
          });
          return;
        }

        sendJson(res, 200, { success: true, text: text.trim(), fields });
      } catch (e) {
        console.error("后端详细报错：", e);
        sendJson(res, 500, { success: false, error: USER_FACING_AI_ERROR });
      }
    });
  };
}
