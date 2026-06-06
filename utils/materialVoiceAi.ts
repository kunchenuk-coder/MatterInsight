import { GoogleGenerativeAI } from "@google/generative-ai";
import { Category } from "../types";
import {
  getGeminiApiKey,
  getQwenApiKey,
  getDeepSeekApiKey,
  shouldFallbackToQwen,
  withTimeout,
} from "./aiMaterialAnalysis";

const QWEN_CHAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";
const TEXT_TIMEOUT_MS = 45_000;

export type MaterialVoiceFields = {
  name?: string;
  category?: string;
  price?: string;
  size?: string;
  remark?: string;
};

export function buildMaterialVoicePrompt(transcript: string): string {
  return `你是一个专业的建筑材料数据结构化助手。请分析用户输入的这段大白话语音：'${transcript.replace(/'/g, "''")}'。
请从中精准提取出以下字段，并严格以 JSON 格式返回，不要包含任何解释或 Markdown 标记：
- name (材料名称)
- category (材料分类，匹配：ST石材, WD木材, MT金属, 本地材料等)
- price (价格区间，只需数字或范围，例如 500-800)
- size (规格尺寸，统一转换为毫米格式，例如 1200×2400mm)
- remark (材料商备注)`;
}

function parseJsonObject(text: string): MaterialVoiceFields {
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
  return parsed as MaterialVoiceFields;
}

export function resolveVoiceCategory(raw?: string): Category | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  const values = Object.values(Category) as string[];
  const exact = values.find((v) => v === t);
  if (exact) return exact as Category;
  const prefix = t.slice(0, 2).toUpperCase();
  const byPrefix = values.find((v) => v.startsWith(prefix));
  if (byPrefix) return byPrefix as Category;
  if (/石材|大理石|岩板|瓷砖/.test(t)) return Category.ST;
  if (/木|板材|地板/.test(t)) return Category.WD;
  if (/金属|不锈钢|铝/.test(t)) return Category.MT;
  if (/玻璃/.test(t)) return Category.GL;
  if (/水泥|微水泥/.test(t)) return Category.CO;
  if (/面料|布|皮革/.test(t)) return Category.FB;
  if (/地毯/.test(t)) return Category.CP;
  if (/本地/.test(t)) return Category.Other;
  return Category.Other;
}

export function voiceFieldsToFormPatch(fields: MaterialVoiceFields): {
  name?: string;
  category?: Category;
  priceRange?: string;
  specifications?: string;
  supplierNotes?: string;
} {
  const patch: ReturnType<typeof voiceFieldsToFormPatch> = {};
  if (fields.name?.trim()) patch.name = fields.name.trim();
  const cat = resolveVoiceCategory(fields.category);
  if (cat) patch.category = cat;
  if (fields.price?.trim()) {
    const p = fields.price.trim().replace(/^¥+/, "");
    patch.priceRange = p.includes("¥") ? p : `¥${p}/㎡`;
  }
  if (fields.size?.trim()) patch.specifications = fields.size.trim();
  if (fields.remark?.trim()) patch.supplierNotes = fields.remark.trim();
  return patch;
}

async function analyzeWithGeminiText(prompt: string): Promise<string> {
  const key = getGeminiApiKey();
  if (!key) throw new Error("NO_GEMINI_KEY");
  const genAI = new GoogleGenerativeAI(key);
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash"];
  let lastErr: unknown;
  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const run = model.generateContent(prompt).then((r) => r.response.text());
      return await withTimeout(run, TEXT_TIMEOUT_MS, "GEMINI_TEXT");
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/\b404\b/.test(msg) && /not found|models\//i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function analyzeWithDeepSeekText(prompt: string): Promise<string> {
  const key = getDeepSeekApiKey();
  if (!key) throw new Error("NO_DEEPSEEK_KEY");
  const model =
    (import.meta.env.VITE_DEEPSEEK_CHAT_MODEL as string | undefined)?.trim() ||
    "deepseek-chat";
  const run = (async () => {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`DEEPSEEK_HTTP_${res.status}: ${t}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("DEEPSEEK_EMPTY");
    return text;
  })();
  return withTimeout(run, TEXT_TIMEOUT_MS, "DEEPSEEK_TEXT");
}

async function analyzeWithQwenText(prompt: string): Promise<string> {
  const key = getQwenApiKey();
  if (!key) throw new Error("NO_QWEN_KEY");
  const model =
    (import.meta.env.VITE_QWEN_CHAT_MODEL as string | undefined)?.trim() ||
    "qwen-turbo";
  const run = (async () => {
    const res = await fetch(QWEN_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`QWEN_HTTP_${res.status}: ${t}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("QWEN_EMPTY");
    return text;
  })();
  return withTimeout(run, TEXT_TIMEOUT_MS, "QWEN_TEXT");
}

/** Gemini → DeepSeek → 千问，将语音转写文本结构化为材料字段 */
export async function structureMaterialFromVoice(
  transcript: string
): Promise<MaterialVoiceFields> {
  const prompt = buildMaterialVoicePrompt(transcript);
  const geminiKey = getGeminiApiKey();
  const dsKey = getDeepSeekApiKey();
  const qwenKey = getQwenApiKey();

  if (!geminiKey && !dsKey && !qwenKey) {
    throw new Error("未配置 AI 密钥，无法解析语音内容");
  }

  let modelText: string;

  if (geminiKey) {
    try {
      modelText = await analyzeWithGeminiText(prompt);
    } catch (gemErr) {
      if (dsKey && shouldFallbackToQwen(gemErr)) {
        try {
          modelText = await analyzeWithDeepSeekText(prompt);
        } catch (dsErr) {
          if (qwenKey) modelText = await analyzeWithQwenText(prompt);
          else throw dsErr;
        }
      } else if (dsKey) {
        try {
          modelText = await analyzeWithDeepSeekText(prompt);
        } catch (dsErr) {
          if (qwenKey) modelText = await analyzeWithQwenText(prompt);
          else throw dsErr;
        }
      } else if (qwenKey) {
        modelText = await analyzeWithQwenText(prompt);
      } else {
        throw gemErr;
      }
    }
  } else if (dsKey) {
    try {
      modelText = await analyzeWithDeepSeekText(prompt);
    } catch (dsErr) {
      if (qwenKey) modelText = await analyzeWithQwenText(prompt);
      else throw dsErr;
    }
  } else {
    modelText = await analyzeWithQwenText(prompt);
  }

  return parseJsonObject(modelText);
}
