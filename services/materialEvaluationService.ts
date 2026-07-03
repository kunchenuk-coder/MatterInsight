import type { Material } from '../types';
import type { MaterialEvaluations, MaterialHumanDna } from '../types/materialDetail';
import { toMaterialDetail } from '../data/materialDetailMock';
import {
  buildMaterialDataPayload,
  readHumanDnaFromMaterial,
  republishMaterial,
} from './materialService';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

const ratedStorageKey = (userId: string, materialId: string) =>
  `matter_insight_eval_${userId}_${materialId}`;

export function hasUserRatedMaterial(userId: string, materialId: string): boolean {
  try {
    return localStorage.getItem(ratedStorageKey(userId, materialId)) === '1';
  } catch {
    return false;
  }
}

function markUserRatedMaterial(userId: string, materialId: string): void {
  try {
    localStorage.setItem(ratedStorageKey(userId, materialId), '1');
  } catch {
    /* ignore quota */
  }
}

export function computeNextEvaluations(
  current: MaterialEvaluations,
  voteCount: number,
  submission: MaterialEvaluations
): { evaluations: MaterialEvaluations; voteCount: number } {
  const keys = Object.keys(current) as Array<keyof MaterialEvaluations>;
  const nextCount = voteCount + 1;
  const evaluations = {} as MaterialEvaluations;

  for (const key of keys) {
    const prev = voteCount > 0 ? current[key] : submission[key];
    const weight = voteCount > 0 ? voteCount : 0;
    evaluations[key] = Number(
      ((prev * weight + submission[key]) / nextCount).toFixed(1)
    );
  }

  return { evaluations, voteCount: nextCount };
}

function syncMaterialRatings(
  material: Material,
  evaluations: MaterialEvaluations
): Material {
  return {
    ...material,
    ratings: {
      aesthetic: evaluations.aesthetics,
      durable: evaluations.durability,
      service: evaluations.service,
      cleanliness: evaluations.cleanliness,
      recommendation: evaluations.recommendation,
    },
  };
}

export interface SubmitMaterialEvaluationInput {
  userId: string;
  materialId: string;
  material: Material;
  submission: MaterialEvaluations;
  currentEvaluations: MaterialEvaluations;
  voteCount: number;
}

export type SubmitMaterialEvaluationResult =
  | { ok: true; material: Material; evaluations: MaterialEvaluations; voteCount: number }
  | { ok: false; error: string };

/**
 * One-time designer rating: merge into Human DNA aggregate and persist when Supabase is configured.
 */
export async function submitMaterialEvaluation(
  input: SubmitMaterialEvaluationInput
): Promise<SubmitMaterialEvaluationResult> {
  const { userId, materialId, material, submission, currentEvaluations, voteCount } = input;

  if (hasUserRatedMaterial(userId, materialId)) {
    return { ok: false, error: '您已提交过评分' };
  }

  const { evaluations, voteCount: nextVoteCount } = computeNextEvaluations(
    currentEvaluations,
    voteCount,
    submission
  );

  const embedded = readHumanDnaFromMaterial(material) ?? toMaterialDetail(material);
  const humanDna: MaterialHumanDna = {
    ...embedded,
    evaluations,
    evaluation_vote_count: nextVoteCount,
  };

  const materialWithRatings = syncMaterialRatings(material, evaluations);
  const payload = buildMaterialDataPayload(materialWithRatings, humanDna);

  if (isSupabaseConfigured()) {
    const { error } = await getSupabase().rpc('submit_material_evaluation', {
      p_material_id: materialId,
      p_evaluations: submission,
    });

    if (error) {
      if (error.message.includes('already rated')) {
        markUserRatedMaterial(userId, materialId);
        return { ok: false, error: '您已提交过评分' };
      }
      console.warn(
        '[materialEvaluationService] RPC submit failed, using client aggregate only:',
        error.message
      );
    }
  } else {
    console.info('[materialEvaluationService] submit (local mock)', {
      material_id: materialId,
      evaluations,
      vote_count: nextVoteCount,
    });
  }

  markUserRatedMaterial(userId, materialId);
  return {
    ok: true,
    material: payload,
    evaluations,
    voteCount: nextVoteCount,
  };
}
