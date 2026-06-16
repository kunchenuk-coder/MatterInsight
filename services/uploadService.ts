import { isSupabaseConfigured } from './supabaseClient';
import {
  fallbackLocalDataUrl,
  uploadViaPresignedUrl,
} from './presignedUploadService';
import type { AssetReviewStatus, UploadFolder } from '../types';

export type { UploadFolder };

export interface UploadResult {
  url: string;
  /** true 表示已上传至 OSS 私有桶 */
  isRemote: boolean;
  /** OSS 对象路径 users/{userId}/assets/... */
  objectKey?: string;
  /** 默认 pending_review，待 AI/人工审核后方可公开 */
  reviewStatus?: AssetReviewStatus;
}

/**
 * 上传图片到阿里云 OSS 私有桶（预签名直传 + 浏览器端压缩）。
 * 未配置 Supabase / 未登录时回退本地 base64，保证离线开发可用。
 *
 * 对外 API 不变，UI 层无需修改。
 */
export async function uploadImage(
  file: File,
  folder: UploadFolder = 'materials'
): Promise<UploadResult> {
  if (!isSupabaseConfigured()) {
    const dataUrl = await fallbackLocalDataUrl(file);
    return { url: dataUrl, isRemote: false };
  }

  try {
    const result = await uploadViaPresignedUrl(file, folder, 'image');
    return {
      url: result.url,
      isRemote: result.isRemote,
      objectKey: result.objectKey,
      reviewStatus: result.reviewStatus,
    };
  } catch (err) {
    console.warn('[uploadService] presigned upload failed, falling back to base64:', err);
    const dataUrl = await fallbackLocalDataUrl(file);
    return { url: dataUrl, isRemote: false };
  }
}

/** 批量上传 */
export async function uploadImages(
  files: File[],
  folder: UploadFolder = 'materials'
): Promise<UploadResult[]> {
  return Promise.all(files.map((f) => uploadImage(f, folder)));
}

/**
 * 预留：上传 3D 模型资产（VR 场景），同样走预签名直传。
 * TODO: 在 VR 模块接入时调用；当前业务未使用。
 */
export async function uploadModel3d(
  file: File,
  folder: UploadFolder = 'materials'
): Promise<UploadResult> {
  if (!isSupabaseConfigured()) {
    return { url: '', isRemote: false };
  }

  try {
    const result = await uploadViaPresignedUrl(file, folder, 'model_3d');
    return {
      url: result.url,
      isRemote: true,
      objectKey: result.objectKey,
      reviewStatus: result.reviewStatus,
    };
  } catch (err) {
    console.error('[uploadService] model_3d upload failed:', err);
    return { url: '', isRemote: false };
  }
}
