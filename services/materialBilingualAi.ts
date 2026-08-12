/**
 * AI zh→en for supplier publish form. Deduct points separately via record_points_consume.
 */

import {
  getDeepSeekApiKey,
  getGeminiApiKey,
  getQwenApiKey,
} from '../utils/aiMaterialAnalysis';

export const AI_BILINGUAL_COST_POINTS = 15;

export type BilingualSourcePayload = {
  name: string;
  description?: string;
  supplierNotes?: string;
  variantNames?: string[];
  /** Official brand mood tags (zh) */
  moodTags?: string[];
};

export type BilingualEnResult = {
  name: string;
  description: string;
  supplierNotes: string;
  variantNames: string[];
  moodTags: string[];
};

function stripJsonFence(text: string): string {
  return text.replace(/```json|```/gi, '').trim();
}

function parseResult(text: string, source: BilingualSourcePayload): BilingualEnResult {
  const stripped = stripJsonFence(text);
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      raw = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    }
  }

  const variantNamesSrc = source.variantNames ?? [];
  const moodTagsSrc = source.moodTags ?? [];
  const variantsRaw = Array.isArray(raw.variantNames) ? raw.variantNames : [];
  const tagsRaw = Array.isArray(raw.moodTags) ? raw.moodTags : [];

  return {
    name: String(raw.name ?? '').trim() || source.name,
    description: String(raw.description ?? '').trim(),
    supplierNotes: String(raw.supplierNotes ?? '').trim(),
    variantNames: variantNamesSrc.map((zh, i) => {
      const en = String(variantsRaw[i] ?? '').trim();
      return en || zh;
    }),
    moodTags: moodTagsSrc.map((zh, i) => {
      const en = String(tagsRaw[i] ?? '').trim();
      return en || zh;
    }),
  };
}

function buildPrompt(source: BilingualSourcePayload): string {
  return (
    'You are a professional materials-catalog translator for interior design.\n' +
    'Translate the following Chinese material listing fields into natural, commercial English.\n' +
    'Keep brand-style product naming concise. Preserve numbers, units (mm, ㎡), fire ratings (Class A), and codes.\n' +
    'Return ONLY a JSON object with keys: name, description, supplierNotes, variantNames (string[]), moodTags (string[]).\n' +
    'variantNames and moodTags must have the same length and order as the input arrays.\n' +
    'If an input field is empty, return an empty string (or [] for arrays) for that key.\n\n' +
    `INPUT_JSON:\n${JSON.stringify(source)}`
  );
}

async function callDeepSeekChat(prompt: string): Promise<string> {
  const key = getDeepSeekApiKey();
  if (!key) throw new Error('DeepSeek API key missing');
  const model =
    (import.meta.env.VITE_DEEPSEEK_CHAT_MODEL &&
      String(import.meta.env.VITE_DEEPSEEK_CHAT_MODEL).trim()) ||
    'deepseek-chat';
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You output valid JSON only. No markdown.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DEEPSEEK_HTTP_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('DeepSeek empty response');
  return text;
}

async function callQwenChat(prompt: string): Promise<string> {
  const key = getQwenApiKey();
  if (!key) throw new Error('Qwen API key missing');
  const model =
    (import.meta.env.VITE_QWEN_CHAT_MODEL &&
      String(import.meta.env.VITE_QWEN_CHAT_MODEL).trim()) ||
    'qwen-plus';
  const res = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You output valid JSON only. No markdown.' },
          { role: 'user', content: prompt },
        ],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`QWEN_HTTP_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('Qwen empty response');
  return text;
}

async function callGeminiChat(prompt: string): Promise<string> {
  const key = getGeminiApiKey();
  if (!key) throw new Error('Gemini API key missing');
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const modelName =
    (import.meta.env.VITE_GEMINI_MODEL && String(import.meta.env.VITE_GEMINI_MODEL).trim()) ||
    'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: 'You output valid JSON only. No markdown.',
  });
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  if (!text?.trim()) throw new Error('Gemini empty response');
  return text;
}

/** Translate Chinese material fields → English. Tries DeepSeek → Qwen → Gemini. */
export async function generateMaterialBilingualEn(
  source: BilingualSourcePayload
): Promise<BilingualEnResult> {
  const name = source.name?.trim();
  if (!name) {
    throw new Error('请先填写材料名称（中文）后再生成双语');
  }

  const payload: BilingualSourcePayload = {
    name,
    description: source.description?.trim() || '',
    supplierNotes: source.supplierNotes?.trim() || '',
    variantNames: (source.variantNames ?? []).map((s) => s.trim()).filter(Boolean),
    moodTags: (source.moodTags ?? []).map((s) => s.trim()).filter(Boolean),
  };

  const prompt = buildPrompt(payload);
  const errors: string[] = [];

  for (const runner of [callDeepSeekChat, callQwenChat, callGeminiChat]) {
    try {
      const text = await runner(prompt);
      return parseResult(text, payload);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  throw new Error(
    errors[0]
      ? `AI 翻译失败：${errors[0]}`
      : 'AI 翻译失败：未配置可用的 API Key（DeepSeek / 千问 / Gemini）'
  );
}
