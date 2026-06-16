import OSS from 'ali-oss';
import COS from 'cos-nodejs-sdk-v5';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type OssProvider = 'aliyun' | 'tencent';

function getProvider(): OssProvider {
  const p = (process.env.OSS_PROVIDER ?? 'aliyun').toLowerCase();
  return p === 'tencent' ? 'tencent' : 'aliyun';
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[mime] ?? '.jpg';
}

function buildObjectKey(folder: string, originalName: string, mime: string): string {
  const ext = path.extname(originalName) || extFromMime(mime);
  const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${safeFolder}/${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
}

async function uploadAliyun(
  buffer: Buffer,
  objectKey: string,
  mime: string
): Promise<string> {
  const region = process.env.ALIYUN_OSS_REGION ?? 'oss-cn-hongkong';
  const bucket = process.env.ALIYUN_OSS_BUCKET;
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  const endpoint = process.env.ALIYUN_OSS_ENDPOINT;
  const publicBase = process.env.ALIYUN_OSS_PUBLIC_BASE_URL;

  if (!bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('阿里云 OSS 环境变量未配置完整');
  }

  const client = new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    ...(endpoint ? { endpoint } : {}),
  });

  const result = await client.put(objectKey, buffer, {
    headers: { 'Content-Type': mime },
  });

  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${objectKey}`;
  }
  return result.url;
}

async function uploadTencent(
  buffer: Buffer,
  objectKey: string,
  mime: string
): Promise<string> {
  const region = process.env.TENCENT_COS_REGION ?? 'ap-hongkong';
  const bucket = process.env.TENCENT_COS_BUCKET;
  const secretId = process.env.TENCENT_COS_SECRET_ID;
  const secretKey = process.env.TENCENT_COS_SECRET_KEY;
  const publicBase = process.env.TENCENT_COS_PUBLIC_BASE_URL;

  if (!bucket || !secretId || !secretKey) {
    throw new Error('腾讯云 COS 环境变量未配置完整');
  }

  const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

  await new Promise<void>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: bucket,
        Region: region,
        Key: objectKey,
        Body: buffer,
        ContentType: mime,
      },
      (err) => (err ? reject(err) : resolve())
    );
  });

  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${objectKey}`;
  }
  return `https://${bucket}.cos.${region}.myqcloud.com/${objectKey}`;
}

export async function uploadToObjectStorage(
  buffer: Buffer,
  folder: string,
  originalName: string,
  mime: string
): Promise<string> {
  const objectKey = buildObjectKey(folder, originalName, mime);
  const provider = getProvider();

  if (provider === 'tencent') {
    return uploadTencent(buffer, objectKey, mime);
  }
  return uploadAliyun(buffer, objectKey, mime);
}
