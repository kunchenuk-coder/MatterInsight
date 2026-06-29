import type { VisionAnalysisResult, VisionSampleAnchor } from './aiMaterialAnalysis';
import {
  analyzeWithDeepSeekVision,
  analyzeWithGemini,
  analyzeWithQwen,
  buildQwenMaterialUserPrompt,
  getAnalysisPromptForDepth,
  getAnchor50pxRgbHintForVision,
  getDeepSeekApiKey,
  getDeepSeekVisionModelName,
  getGeminiApiKey,
  getQwenApiKey,
} from './aiMaterialAnalysis';

export type VisionAgentId = 'gemini' | 'qwen' | 'deepseek';
export type RecognitionDepth = 'basic' | 'deep';

export type VisionTokenEstimate = {
  input: number;
  output: number;
  total: number;
};

export type VisionAgentConfig = {
  id: VisionAgentId;
  name: string;
  subtitle: string;
  pointsBasic: number;
  pointsDeep: number;
  estTokensBasic: VisionTokenEstimate;
  estTokensDeep: VisionTokenEstimate;
  badge?: string;
};

export const VISION_AGENTS: VisionAgentConfig[] = [
  {
    id: 'gemini',
    name: 'Gemini Flash',
    subtitle: 'Google · 速度快、识别均衡',
    pointsBasic: 15,
    pointsDeep: 38,
    estTokensBasic: { input: 1280, output: 320, total: 1600 },
    estTokensDeep: { input: 1280, output: 880, total: 2160 },
    badge: '推荐',
  },
  {
    id: 'qwen',
    name: '通义千问 VL',
    subtitle: '阿里云 · 中文材质名更准',
    pointsBasic: 18,
    pointsDeep: 42,
    estTokensBasic: { input: 1350, output: 360, total: 1710 },
    estTokensDeep: { input: 1350, output: 920, total: 2270 },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Vision',
    subtitle: 'DeepSeek · 性价比高',
    pointsBasic: 12,
    pointsDeep: 32,
    estTokensBasic: { input: 1180, output: 300, total: 1480 },
    estTokensDeep: { input: 1180, output: 850, total: 2030 },
    badge: '省点',
  },
];

export function getAgentModelLabel(id: VisionAgentId): string {
  switch (id) {
    case 'gemini':
      return (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || 'gemini-2.5-flash';
    case 'qwen': {
      const m = import.meta.env.VITE_QWEN_VISION_MODEL as string | undefined;
      return m?.trim() || 'qwen-vl-plus';
    }
    case 'deepseek':
      return getDeepSeekVisionModelName() || 'deepseek-vl';
    default:
      return '';
  }
}

export function isVisionAgentAvailable(id: VisionAgentId): boolean {
  switch (id) {
    case 'gemini':
      return !!getGeminiApiKey();
    case 'qwen':
      return !!getQwenApiKey();
    case 'deepseek':
      return !!(getDeepSeekApiKey() && getDeepSeekVisionModelName());
    default:
      return false;
  }
}

export function getAvailableVisionAgents(): VisionAgentConfig[] {
  return VISION_AGENTS.filter((a) => isVisionAgentAvailable(a.id));
}

export function getVisionAgent(id: VisionAgentId): VisionAgentConfig {
  return VISION_AGENTS.find((a) => a.id === id) ?? VISION_AGENTS[0]!;
}

export function getPointsCost(agent: VisionAgentConfig, depth: RecognitionDepth): number {
  return depth === 'deep' ? agent.pointsDeep : agent.pointsBasic;
}

export function getTokenEstimate(agent: VisionAgentConfig, depth: RecognitionDepth): VisionTokenEstimate {
  return depth === 'deep' ? agent.estTokensDeep : agent.estTokensBasic;
}

export function getMaterialCountForDepth(depth: RecognitionDepth): number {
  return depth === 'deep' ? 10 : 3;
}

/** 按用户选择的 Agent 调用（不自动降级到其他模型） */
export async function analyzeWithVisionAgent(
  agentId: VisionAgentId,
  depth: RecognitionDepth,
  imageDataUrl: string,
  base64Part: string,
  mimeType: string,
  opts?: {
    onRateLimitWait?: (attempt: number, delayMs: number) => void;
    sampleAnchor?: VisionSampleAnchor;
  }
): Promise<VisionAnalysisResult> {
  const prompt = getAnalysisPromptForDepth(depth);
  let userPrompt = prompt;

  if (opts?.sampleAnchor && imageDataUrl) {
    const hint = await getAnchor50pxRgbHintForVision(imageDataUrl, opts.sampleAnchor);
    if (hint.trim()) userPrompt = `${hint}\n\n${prompt}`;
  }

  switch (agentId) {
    case 'gemini': {
      const key = getGeminiApiKey();
      if (!key) throw new Error('Gemini 未配置');
      return analyzeWithGemini(key, userPrompt, base64Part, mimeType, opts);
    }
    case 'qwen': {
      const key = getQwenApiKey();
      if (!key) throw new Error('千问未配置');
      const qwenPrompt = await buildQwenMaterialUserPrompt(imageDataUrl, prompt, opts?.sampleAnchor);
      return analyzeWithQwen(key, imageDataUrl, qwenPrompt, opts);
    }
    case 'deepseek': {
      const key = getDeepSeekApiKey();
      if (!key || !getDeepSeekVisionModelName()) throw new Error('DeepSeek 未配置');
      const dsPrompt = await buildQwenMaterialUserPrompt(imageDataUrl, prompt, opts?.sampleAnchor);
      return analyzeWithDeepSeekVision(key, imageDataUrl, dsPrompt, opts);
    }
    default:
      throw new Error('未知 Agent');
  }
}
