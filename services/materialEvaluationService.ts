import type { Material } from '../types';
import type { MaterialEvaluations, MaterialHumanDna } from '../types/materialDetail';
import { toMaterialDetail } from '../data/materialDetailMock';
import {
  buildMaterialDataPayload,
  readHumanDnaFromMaterial,
} from './materialService';
import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import { normalizeMaterialIdForEventLog } from './eventLogService';
import type { AppPortal } from '../utils/appPortal';

export type MaterialEvaluationStatus = 'submitted' | 'disputed' | 'revoked';

export type MaterialEvaluationRow = {
  id: string;
  materialId: string;
  designerId: string;
  designerName: string;
  designerEmail: string;
  designerUsername: string;
  projectName: string;
  evaluations: MaterialEvaluations;
  status: MaterialEvaluationStatus;
  commitmentConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
  disputedAt: string | null;
  supplierId: string | null;
  supplierPhone: string;
  materialName: string;
};

const EVAL_KEYS: Array<keyof MaterialEvaluations> = [
  'aesthetics',
  'durability',
  'service',
  'cleanliness',
  'recommendation',
];

export function evaluationAverage(scores: MaterialEvaluations): number {
  const vals = EVAL_KEYS.map((k) => Number(scores[k]) || 0);
  if (!vals.length) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export function isLowEvaluation(scores: MaterialEvaluations): boolean {
  return evaluationAverage(scores) < 2 || EVAL_KEYS.some((k) => Number(scores[k]) <= 1);
}

function parseEvaluations(raw: unknown, fallback?: MaterialEvaluations): MaterialEvaluations {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const base = fallback ?? {
    aesthetics: 4,
    durability: 4,
    service: 4,
    cleanliness: 4,
    recommendation: 4,
  };
  const out = { ...base };
  for (const key of EVAL_KEYS) {
    const n = Number(src[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function mapEvaluationRow(row: Record<string, unknown>): MaterialEvaluationRow {
  return {
    id: String(row.id ?? ''),
    materialId: String(row.material_id ?? ''),
    designerId: String(row.designer_id ?? ''),
    designerName: String(row.designer_name ?? '设计师'),
    designerEmail: String(row.designer_email ?? ''),
    designerUsername: String(row.designer_username ?? ''),
    projectName: String(row.project_name ?? ''),
    evaluations: parseEvaluations(row.evaluations),
    status: (String(row.status ?? 'submitted') as MaterialEvaluationStatus) || 'submitted',
    commitmentConfirmed: Boolean(row.commitment_confirmed),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    disputedAt: row.disputed_at ? String(row.disputed_at) : null,
    supplierId: row.supplier_id ? String(row.supplier_id) : null,
    supplierPhone: String(row.supplier_phone ?? ''),
    materialName: String(row.material_name ?? ''),
  };
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
    evaluations[key] = Number(((prev * weight + submission[key]) / nextCount).toFixed(1));
  }

  return { evaluations, voteCount: nextCount };
}

function syncMaterialRatings(material: Material, evaluations: MaterialEvaluations): Material {
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

function applyAggregateToMaterial(
  material: Material,
  evaluations: MaterialEvaluations,
  voteCount: number
): Material {
  const embedded = readHumanDnaFromMaterial(material) ?? toMaterialDetail(material);
  const humanDna: MaterialHumanDna = {
    ...embedded,
    evaluations,
    evaluation_vote_count: voteCount,
  };
  return buildMaterialDataPayload(syncMaterialRatings(material, evaluations), humanDna);
}

function parseAggregatePayload(
  data: unknown,
  current: MaterialEvaluations,
  voteCount: number
): { evaluations: MaterialEvaluations; voteCount: number; evaluationId?: string; projectName?: string } {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const evaluations = parseEvaluations(row, current);
  const nextCount = Number(row.evaluation_vote_count);
  return {
    evaluations,
    voteCount: Number.isFinite(nextCount) ? nextCount : voteCount,
    evaluationId: row.evaluation_id ? String(row.evaluation_id) : undefined,
    projectName: row.project_name ? String(row.project_name) : undefined,
  };
}

export async function fetchMaterialEvaluations(
  materialId?: string | null,
  portal?: AppPortal
): Promise<MaterialEvaluationRow[]> {
  if (!isSupabaseConfigured()) return [];
  const client = portal ? getSupabaseForPortal(portal) : getSupabase();
  const materialUuid = materialId ? normalizeMaterialIdForEventLog(materialId) : null;
  if (materialId && !materialUuid) return [];
  const { data, error } = await client.rpc('list_material_evaluations', {
    p_material_id: materialUuid,
  });
  if (error) {
    console.error('[materialEvaluationService] list failed:', error.message);
    return [];
  }
  return (data ?? []).map((row: Record<string, unknown>) => mapEvaluationRow(row));
}

export async function fetchMyMaterialEvaluation(
  materialId: string,
  designerId: string
): Promise<MaterialEvaluationRow | null> {
  const rows = await fetchMaterialEvaluations(materialId, 'designer');
  return rows.find((r) => r.designerId === designerId && r.status !== 'revoked') ?? null;
}

export interface SubmitMaterialEvaluationInput {
  userId: string;
  materialId: string;
  material: Material;
  submission: MaterialEvaluations;
  currentEvaluations: MaterialEvaluations;
  voteCount: number;
  projectName?: string | null;
  projectAdoptionId?: string | null;
  evaluationId?: string | null;
}

export type SubmitMaterialEvaluationResult =
  | { ok: true; material: Material; evaluations: MaterialEvaluations; voteCount: number; evaluationId?: string }
  | { ok: false; error: string };

export async function submitMaterialEvaluation(
  input: SubmitMaterialEvaluationInput
): Promise<SubmitMaterialEvaluationResult> {
  const {
    materialId,
    material,
    submission,
    currentEvaluations,
    voteCount,
    projectName,
    projectAdoptionId,
    evaluationId,
  } = input;

  if (!isSupabaseConfigured()) {
    return { ok: false, error: '服务未配置，无法提交评分' };
  }

  const client = getSupabase();
  const isUpdate = Boolean(evaluationId);
  const materialUuid = normalizeMaterialIdForEventLog(materialId);
  if (!isUpdate && !materialUuid) {
    return { ok: false, error: '材料 ID 无效，无法提交评分' };
  }
  const adoptionUuid = projectAdoptionId
    ? normalizeMaterialIdForEventLog(projectAdoptionId)
    : null;
  const { data, error } = isUpdate
    ? await client.rpc('update_material_evaluation', {
        p_evaluation_id: evaluationId,
        p_evaluations: submission,
        p_commitment_confirmed: true,
        p_project_name: projectName ?? null,
      })
    : await client.rpc('submit_material_evaluation', {
        p_material_id: materialUuid,
        p_evaluations: submission,
        p_project_name: projectName ?? null,
        p_commitment_confirmed: true,
        p_project_adoption_id: adoptionUuid,
      });

  if (error) {
    const msg = error.message || '';
    if (msg.includes('already rated')) return { ok: false, error: '您已提交过评分' };
    if (msg.includes('commitment required')) return { ok: false, error: '请先确认评分承诺' };
    if (msg.includes('only designers')) return { ok: false, error: '仅设计师可以评分' };
    console.error('[materialEvaluationService] RPC failed:', msg);
    return { ok: false, error: '评分提交失败，请稍后重试' };
  }

  const parsed = parseAggregatePayload(data, currentEvaluations, isUpdate ? voteCount : voteCount + 1);
  return {
    ok: true,
    material: applyAggregateToMaterial(material, parsed.evaluations, parsed.voteCount),
    evaluations: parsed.evaluations,
    voteCount: parsed.voteCount,
    evaluationId: parsed.evaluationId ?? evaluationId ?? undefined,
  };
}

export async function disputeMaterialEvaluation(
  evaluationId: string,
  portal: AppPortal = 'supplier'
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: '服务未配置' };
  const { error } = await getSupabaseForPortal(portal).rpc('dispute_material_evaluation', {
    p_evaluation_id: evaluationId,
  });
  if (error) {
    console.error('[materialEvaluationService] dispute failed:', error.message);
    return { ok: false, error: '复议提交失败，请稍后重试' };
  }
  return { ok: true };
}

export async function adminSetEvaluationStatus(
  evaluationId: string,
  status: MaterialEvaluationStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: '服务未配置' };
  const { error } = await getSupabaseForPortal('admin').rpc('admin_set_evaluation_status', {
    p_evaluation_id: evaluationId,
    p_status: status,
  });
  if (error) {
    console.error('[materialEvaluationService] admin status failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
