import { MOCK_MATERIALS } from '../constants';
import type { Material } from '../types';
import { readHumanDnaFromMaterial } from '../services/materialService';
import type {
  MaterialDetail,
  MaterialHumanDna,
} from '../types/materialDetail';

const DEFAULT_HUMAN_DNA: MaterialHumanDna = {
  ai_trained_status: false,
  application_cases: [],
  evaluations: {
    durability: 4.0,
    service: 4.0,
    aesthetics: 4.0,
    cleanliness: 4.0,
    recommendation: 4.0,
  },
  mood_tags: [],
  inspiration_stories: [],
};

/** Human DNA mock payloads keyed by material id (dev / UI prototyping). */
export const MOCK_MATERIAL_HUMAN_DNA: Record<string, MaterialHumanDna> = {
  mat_st_01: {
    ai_trained_status: true,
    application_cases: [
      {
        id: 'case_st_01',
        url: 'https://images.unsplash.com/photo-1600607687940-4e2a09695d51?auto=format&fit=crop&w=800&q=80',
        is_for_training: true,
      },
      {
        id: 'case_st_02',
        url: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=800&q=80',
        is_for_training: true,
      },
      {
        id: 'case_st_03',
        url: 'https://images.unsplash.com/photo-1600210492496-724fe5c67fb0?auto=format&fit=crop&w=800&q=80',
        is_for_training: false,
      },
      {
        id: 'case_st_04',
        url: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=800&q=80',
        is_for_training: false,
      },
    ],
    evaluations: {
      durability: 4.5,
      service: 4.2,
      aesthetics: 4.8,
      cleanliness: 4.0,
      recommendation: 4.7,
    },
    mood_tags: [
      { tag: '极简', count: 128, is_custom: false },
      { tag: '轻奢', count: 86, is_custom: false },
      { tag: '灰暗', count: 72, is_custom: false },
      { tag: '冷静', count: 65, is_custom: false },
      { tag: '理性', count: 58, is_custom: false },
      { tag: '自然纹理', count: 54, is_custom: false },
      { tag: '留白感', count: 31, is_custom: true },
    ],
    inspiration_stories: [
      {
        id: 'story_st_01',
        author_id: 'designer_01',
        text: '大面积铺贴后空间非常通透，灰白纹理像云一样流动，适合作为客厅主背景。',
        status: 'approved',
      },
      {
        id: 'story_st_02',
        author_id: 'designer_02',
        text: '与浅木色家具搭配时层次很好，但湿区建议选防滑处理版本。',
        status: 'approved',
      },
      {
        id: 'story_st_03',
        author_id: 'designer_03',
        text: '待审核：想用在酒店大堂旋转楼梯墙面。',
        status: 'pending',
      },
    ],
  },
  mat_ct_01: {
    ai_trained_status: true,
    application_cases: [
      {
        id: 'case_ct_01',
        url: 'https://images.unsplash.com/photo-1523413363574-c3c44b359d57?auto=format&fit=crop&w=800&q=80',
        is_for_training: true,
      },
      {
        id: 'case_ct_02',
        url: 'https://images.unsplash.com/photo-1516455590571-18256e5bb9ff?auto=format&fit=crop&w=800&q=80',
        is_for_training: false,
      },
    ],
    evaluations: {
      durability: 4.9,
      service: 4.5,
      aesthetics: 4.2,
      cleanliness: 4.8,
      recommendation: 4.5,
    },
    mood_tags: [
      { tag: '工业风', count: 92, is_custom: false },
      { tag: '粗犷', count: 47, is_custom: false },
      { tag: '水泥质感', count: 38, is_custom: true },
    ],
    inspiration_stories: [
      {
        id: 'story_ct_01',
        author_id: 'designer_04',
        text: '用于开放式厨房地面，耐磨且好打理，和黑色金属橱柜非常搭。',
        status: 'approved',
      },
    ],
  },
  mat_wd_01: {
    ai_trained_status: false,
    application_cases: [
      {
        id: 'case_wd_01',
        url: 'https://images.unsplash.com/photo-1533090161767-e6ffed986c88?auto=format&fit=crop&w=800&q=80',
        is_for_training: false,
      },
    ],
    evaluations: {
      durability: 4.0,
      service: 4.8,
      aesthetics: 5.0,
      cleanliness: 3.5,
      recommendation: 4.9,
    },
    mood_tags: [
      { tag: '温润', count: 76, is_custom: false },
      { tag: '高端定制', count: 63, is_custom: false },
      { tag: '深色木感', count: 29, is_custom: true },
    ],
    inspiration_stories: [
      {
        id: 'story_wd_01',
        author_id: 'designer_05',
        text: '整面背景墙效果惊艳，但需注意色差批次，建议一次性备货。',
        status: 'approved',
      },
      {
        id: 'story_wd_02',
        author_id: 'designer_06',
        text: '样品颜色偏深，实际大货略浅，已驳回待补充实拍。',
        status: 'rejected',
      },
    ],
  },
  mat_mt_01: {
    ai_trained_status: true,
    application_cases: [
      {
        id: 'case_mt_01',
        url: 'https://images.unsplash.com/photo-1558444458-5c455962af70?auto=format&fit=crop&w=800&q=80',
        is_for_training: true,
      },
      {
        id: 'case_mt_02',
        url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80',
        is_for_training: true,
      },
      {
        id: 'case_mt_03',
        url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80',
        is_for_training: false,
      },
    ],
    evaluations: {
      durability: 5.0,
      service: 4.3,
      aesthetics: 4.5,
      cleanliness: 4.7,
      recommendation: 4.6,
    },
    mood_tags: [
      { tag: '现代简约', count: 105, is_custom: false },
      { tag: '金属质感', count: 88, is_custom: false },
      { tag: '科技感', count: 42, is_custom: true },
    ],
    inspiration_stories: [
      {
        id: 'story_mt_01',
        author_id: 'designer_07',
        text: '电梯厅墙面用拉丝不锈钢，反光控制得当，不会显得廉价。',
        status: 'approved',
      },
    ],
  },
};

/** Merge partial/missing humanDna with defaults so detail UI never sees undefined arrays. */
function mergeHumanDna(partial?: Partial<MaterialHumanDna> | null): MaterialHumanDna {
  const base = DEFAULT_HUMAN_DNA;
  const src = partial ?? {};
  return {
    ai_trained_status: Boolean(src.ai_trained_status ?? base.ai_trained_status),
    application_cases: Array.isArray(src.application_cases)
      ? src.application_cases
      : base.application_cases,
    evaluations: {
      ...base.evaluations,
      ...(src.evaluations && typeof src.evaluations === 'object' ? src.evaluations : {}),
    },
    mood_tags: Array.isArray(src.mood_tags) ? src.mood_tags : base.mood_tags,
    inspiration_stories: Array.isArray(src.inspiration_stories)
      ? src.inspiration_stories
      : base.inspiration_stories,
    evaluation_vote_count:
      typeof src.evaluation_vote_count === 'number'
        ? src.evaluation_vote_count
        : base.evaluation_vote_count ?? 0,
  };
}

/** Merge base material with Human DNA (embedded data or mock fallback). */
export function toMaterialDetail(material: Material): MaterialDetail {
  const embedded = readHumanDnaFromMaterial(material);
  const humanDna = mergeHumanDna(
    embedded ?? MOCK_MATERIAL_HUMAN_DNA[material.id] ?? DEFAULT_HUMAN_DNA
  );
  return { ...material, ...humanDna };
}

export function buildHumanDnaSnapshot(
  detail: MaterialDetail
): MaterialHumanDna {
  return {
    ai_trained_status: detail.ai_trained_status,
    application_cases: detail.application_cases,
    evaluations: detail.evaluations,
    evaluation_vote_count: detail.evaluation_vote_count,
    mood_tags: detail.mood_tags,
    inspiration_stories: detail.inspiration_stories,
  };
}

/** Look up a mock detail record by material id (`constants.tsx` catalog). */
export function getMockMaterialDetail(materialId: string): MaterialDetail | undefined {
  const material = MOCK_MATERIALS.find((m) => m.id === materialId);
  if (!material) return undefined;
  return toMaterialDetail(material);
}

/** All mock materials enriched with Human DNA fields. */
export const MOCK_MATERIAL_DETAILS: MaterialDetail[] = MOCK_MATERIALS.map(toMaterialDetail);
