import { isSupabaseConfigured } from './supabaseClient';
import {
  fallbackLocalDataUrl,
  uploadViaPresignedUrl,
} from './presignedUploadService';
import type { AssetReviewStatus, AssetType, UploadFolder } from '../types';

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
  return uploadAsset(file, folder, 'image');
}

const PDF_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export function validateCatalogPdf(file: File): string | null {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return '仅支持 PDF 文件';
  if (file.size > PDF_MAX_BYTES) return 'PDF 不能超过 50MB';
  return null;
}

export function validateInstallationFile(
  file: File
): { ok: true; assetType: 'image' | 'video' } | { ok: false; error: string } {
  if (file.type.startsWith('image/')) {
    return { ok: true, assetType: 'image' };
  }
  const isVideo =
    file.type.startsWith('video/') ||
    /\.(mp4|webm|mov|m4v)$/i.test(file.name);
  if (isVideo) {
    if (file.size > VIDEO_MAX_BYTES) return { ok: false, error: '视频不能超过 100MB' };
    return { ok: true, assetType: 'video' };
  }
  return { ok: false, error: '仅支持图片或视频' };
}

/**
 * 上传任意允许的资产类型到 OSS（PDF / 视频不走图片压缩）。
 */
export async function uploadAsset(
  file: File,
  folder: UploadFolder = 'materials',
  assetType: AssetType = 'image'
): Promise<UploadResult> {
  if (!isSupabaseConfigured()) {
    if (assetType === 'image') {
      const dataUrl = await fallbackLocalDataUrl(file);
      return { url: dataUrl, isRemote: false };
    }
    const dataUrl = URL.createObjectURL(file);
    return { url: dataUrl, isRemote: false };
  }

  try {
    const result = await uploadViaPresignedUrl(file, folder, assetType);
    return {
      url: result.url,
      isRemote: result.isRemote,
      objectKey: result.objectKey,
      reviewStatus: result.reviewStatus,
    };
  } catch (err) {
    console.warn('[uploadService] presigned upload failed, falling back:', err);
    if (assetType === 'image') {
      const dataUrl = await fallbackLocalDataUrl(file);
      return { url: dataUrl, isRemote: false };
    }
    throw err;
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
