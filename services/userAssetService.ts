import type { AssetReviewStatus, AssetType, UserAsset } from '../types';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';

export interface RecordUserAssetInput {
  userId: string;
  assetType: AssetType;
  ossObjectKey: string;
  contentType?: string;
  fileName?: string;
  category?: string;
  model3dUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 上传成功后登记资产，默认 pending_review（不对外公开可用）。
 * 未来 AI 审核通过后可更新 review_status → approved。
 */
export async function recordUserAsset(
  input: RecordUserAssetInput
): Promise<UserAsset | null> {
  if (!isSupabaseConfigured() || !input.userId) return null;

  const row = {
    user_id: input.userId,
    asset_type: input.assetType,
    oss_object_key: input.ossObjectKey,
    content_type: input.contentType ?? null,
    file_name: input.fileName ?? null,
    category: input.category ?? null,
    review_status: 'pending_review' as AssetReviewStatus,
    model_3d_url: input.model3dUrl ?? null,
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getSupabase()
    .from('user_assets')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    console.error('[userAssetService] recordUserAsset:', error.message);
    return null;
  }

  return mapRow(data as Record<string, unknown>);
}

/** 查询当前用户待审核资产（供未来审核面板使用） */
export async function fetchPendingReviewAssets(
  userId: string
): Promise<UserAsset[]> {
  if (!isSupabaseConfigured() || !userId) return [];

  const { data, error } = await getSupabase()
    .from('user_assets')
    .select('*')
    .eq('user_id', userId)
    .eq('review_status', 'pending_review')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[userAssetService] fetchPendingReviewAssets:', error.message);
    return [];
  }

  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

function mapRow(row: Record<string, unknown>): UserAsset {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    assetType: (row.asset_type as AssetType) ?? 'image',
    ossObjectKey: String(row.oss_object_key),
    contentType: row.content_type ? String(row.content_type) : undefined,
    fileName: row.file_name ? String(row.file_name) : undefined,
    category: row.category ? String(row.category) : undefined,
    reviewStatus: (row.review_status as AssetReviewStatus) ?? 'pending_review',
    model3dUrl: row.model_3d_url ? String(row.model_3d_url) : undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
