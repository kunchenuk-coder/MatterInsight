import { getAccessToken } from './authService';
import { getCurrentUserId, isSupabaseConfigured } from './supabaseClient';
import { recordUserAsset } from './userAssetService';
import { compressImageForUpload } from '../utils/compressImageForUpload';
import { compressImage } from '../utils/imageCompression';
import type { AssetReviewStatus, AssetType, UploadFolder } from '../types';

export interface PresignedUploadResult {
  url: string;
  objectKey: string;
  isRemote: true;
  reviewStatus: AssetReviewStatus;
  assetType: AssetType;
}

interface PresignApiResponse {
  uploadUrl: string;
  objectKey: string;
  readUrl: string;
  expiresAt: string;
  contentType: string;
  error?: string;
}

async function requestPresignedUrl(
  token: string,
  file: File,
  category: UploadFolder,
  assetType: AssetType
): Promise<PresignApiResponse> {
  const res = await fetch('/api/get-upload-url', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name || 'upload.jpg',
      contentType: file.type || 'image/jpeg',
      category,
      assetType,
    }),
  });

  const json = (await res.json()) as PresignApiResponse;
  if (!res.ok || !json.uploadUrl || !json.objectKey) {
    throw new Error(json.error ?? '获取上传签名失败');
  }
  return json;
}

/**
 * 私有桶安全直传：浏览器压缩 → 预签名 PUT → 登记 user_assets（pending_review）
 */
export async function uploadViaPresignedUrl(
  file: File,
  category: UploadFolder = 'materials',
  assetType: AssetType = 'image'
): Promise<PresignedUploadResult> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('未登录');
  }

  const compressed =
    assetType === 'image' ? await compressImageForUpload(file) : file;

  const presigned = await requestPresignedUrl(
    token,
    compressed,
    category,
    assetType
  );

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': presigned.contentType,
    },
    body: compressed,
  });

  if (!putRes.ok) {
    throw new Error(`OSS PUT 失败 (${putRes.status})`);
  }

  const userId = await getCurrentUserId();

  if (isSupabaseConfigured() && userId) {
    await recordUserAsset({
      userId,
      assetType,
      ossObjectKey: presigned.objectKey,
      contentType: presigned.contentType,
      fileName: compressed.name,
      category,
      metadata: { source: 'presigned_upload' },
    });
  }

  return {
    url: presigned.readUrl,
    objectKey: presigned.objectKey,
    isRemote: true,
    reviewStatus: 'pending_review',
    assetType,
  };
}

/** 离线 / 未配置 Supabase 时回退 base64 */
export async function fallbackLocalDataUrl(file: File): Promise<string> {
  return compressImage(file);
}
