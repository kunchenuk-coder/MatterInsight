import OSS from 'ali-oss';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const PRESIGN_PUT_EXPIRES_SEC = 300;
const PRESIGN_GET_EXPIRES_SEC = 7 * 24 * 3600;

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MODEL_3D_EXT = new Set(['.glb', '.gltf', '.usdz', '.fbx', '.obj']);

export type AssetType = 'image' | 'model_3d';

function getOssClient(): OSS {
  const region = process.env.ALIYUN_OSS_REGION ?? 'oss-cn-hongkong';
  const bucket = process.env.ALIYUN_OSS_BUCKET;
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  const endpoint = process.env.ALIYUN_OSS_ENDPOINT;

  if (!bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('阿里云 OSS 环境变量未配置完整');
  }

  return new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    ...(endpoint ? { endpoint } : {}),
  });
}

function resolveExtension(
  assetType: AssetType,
  contentType: string,
  fileName: string
): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (assetType === 'model_3d') {
    if (fromName && MODEL_3D_EXT.has(fromName)) return fromName;
    return '.glb';
  }
  return fromName || IMAGE_EXT[contentType] || '.jpg';
}

/** 强制路径：users/{userId}/assets/{category}/... */
export function buildUserAssetObjectKey(
  userId: string,
  category: string,
  fileName: string,
  contentType: string,
  assetType: AssetType = 'image'
): string {
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
  const ext = resolveExtension(assetType, contentType, fileName);
  const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  return `users/${userId}/assets/${safeCategory}/${stamp}${ext}`;
}

export interface PresignedUploadUrls {
  uploadUrl: string;
  objectKey: string;
  readUrl: string;
  expiresAt: string;
  contentType: string;
}

export function createPresignedUploadUrls(
  userId: string,
  category: string,
  fileName: string,
  contentType: string,
  assetType: AssetType = 'image'
): PresignedUploadUrls {
  const client = getOssClient();
  const objectKey = buildUserAssetObjectKey(
    userId,
    category,
    fileName,
    contentType,
    assetType
  );
  const mime = contentType || (assetType === 'model_3d' ? 'model/gltf-binary' : 'image/jpeg');

  const uploadUrl = client.signatureUrl(objectKey, {
    method: 'PUT',
    expires: PRESIGN_PUT_EXPIRES_SEC,
    'Content-Type': mime,
  });

  const readUrl = client.signatureUrl(objectKey, {
    method: 'GET',
    expires: PRESIGN_GET_EXPIRES_SEC,
  });

  const expiresAt = new Date(Date.now() + PRESIGN_PUT_EXPIRES_SEC * 1000).toISOString();

  return { uploadUrl, objectKey, readUrl, expiresAt, contentType: mime };
}

export interface ServerUploadResult {
  objectKey: string;
  readUrl: string;
  contentType: string;
}

/**
 * 服务端直传：浏览器把文件 POST 到我们自己的后端，后端用 OSS SDK 直接 put。
 * 避免浏览器 -> OSS 的跨域（CORS）限制，适合私有桶 + “阻止公共访问”场景。
 * 返回私有桶可用的预签名读取 URL。
 */
export async function putUserAssetToOss(
  userId: string,
  category: string,
  fileName: string,
  contentType: string,
  assetType: AssetType,
  buffer: Buffer
): Promise<ServerUploadResult> {
  const client = getOssClient();
  const objectKey = buildUserAssetObjectKey(
    userId,
    category,
    fileName,
    contentType,
    assetType
  );
  const mime =
    contentType || (assetType === 'model_3d' ? 'model/gltf-binary' : 'image/jpeg');

  await client.put(objectKey, buffer, { headers: { 'Content-Type': mime } });

  const readUrl = client.signatureUrl(objectKey, {
    method: 'GET',
    expires: PRESIGN_GET_EXPIRES_SEC,
  });

  return { objectKey, readUrl, contentType: mime };
}

/** 为已存在的 objectKey 生成短期可读 URL（私有桶展示用） */
export function createPresignedReadUrl(objectKey: string, expiresSec = 3600): string {
  const client = getOssClient();
  return client.signatureUrl(objectKey, {
    method: 'GET',
    expires: expiresSec,
  });
}

export function resolvePublicOrSignedUrl(objectKey: string): string {
  const publicBase = process.env.ALIYUN_OSS_PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${objectKey}`;
  }
  return createPresignedReadUrl(objectKey, PRESIGN_GET_EXPIRES_SEC);
}
