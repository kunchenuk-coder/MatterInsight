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

interface UploadedObject {
  readUrl: string;
  objectKey: string;
  contentType: string;
}

/**
 * 服务端代理上传：把文件 POST 给我们自己的后端，由后端用 OSS SDK 直传私有桶。
 * 用于浏览器 → OSS 直传被 CORS 拦截（Failed to fetch）时的兜底路径。
 */
async function uploadViaServerProxy(
  token: string,
  file: File | Blob,
  fileName: string,
  category: UploadFolder,
  assetType: AssetType
): Promise<UploadedObject> {
  const form = new FormData();
  form.append('file', file, fileName);

  const res = await fetch(
    `/api/upload-asset?category=${encodeURIComponent(category)}&assetType=${assetType}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  const json = (await res.json()) as {
    url?: string;
    objectKey?: string;
    contentType?: string;
    error?: string;
  };

  if (!res.ok || !json.url || !json.objectKey) {
    throw new Error(json.error ?? '服务端代理上传失败');
  }

  return {
    readUrl: json.url,
    objectKey: json.objectKey,
    contentType: json.contentType ?? (file as File).type ?? 'image/jpeg',
  };
}

/** 浏览器 → OSS 预签名直传（需 OSS 桶已配置 CORS） */
async function uploadViaDirectPut(
  token: string,
  file: File,
  category: UploadFolder,
  assetType: AssetType
): Promise<UploadedObject> {
  const presigned = await requestPresignedUrl(token, file, category, assetType);

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presigned.contentType },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`OSS PUT 失败 (${putRes.status})`);
  }

  return {
    readUrl: presigned.readUrl,
    objectKey: presigned.objectKey,
    contentType: presigned.contentType,
  };
}

/**
 * 私有桶安全上传：浏览器压缩 → 预签名直传（CORS 失败则自动回退服务端代理）→
 * 登记 user_assets（pending_review）。
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
  const fileName = (compressed as File).name || file.name || 'upload.jpg';

  let uploaded: UploadedObject;
  try {
    uploaded = await uploadViaDirectPut(token, compressed as File, category, assetType);
  } catch (directErr) {
    // 典型为浏览器 → OSS 跨域被拦截（TypeError: Failed to fetch）。
    // 回退到服务端代理上传，避免依赖 OSS 桶的 CORS 配置。
    console.warn('[presignedUpload] 直传失败，改用服务端代理上传:', directErr);
    uploaded = await uploadViaServerProxy(
      token,
      compressed,
      fileName,
      category,
      assetType
    );
  }

  const userId = await getCurrentUserId();

  if (isSupabaseConfigured() && userId) {
    await recordUserAsset({
      userId,
      assetType,
      ossObjectKey: uploaded.objectKey,
      contentType: uploaded.contentType,
      fileName,
      category,
      metadata: { source: 'presigned_upload' },
    });
  }

  return {
    url: uploaded.readUrl,
    objectKey: uploaded.objectKey,
    isRemote: true,
    reviewStatus: 'pending_review',
    assetType,
  };
}

/** 离线 / 未配置 Supabase 时回退 base64 */
export async function fallbackLocalDataUrl(file: File): Promise<string> {
  return compressImage(file);
}
