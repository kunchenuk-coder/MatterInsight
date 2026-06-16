import imageCompression from 'browser-image-compression';

export interface CompressOptions {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  useWebWorker?: boolean;
}

const DEFAULT_OPTIONS: CompressOptions = {
  maxSizeMB: 1.2,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
};

/**
 * 上传前在浏览器端压缩图片，节省 OSS 存储与流量。
 * 非 image/* 文件原样返回（如未来 3D 模型直传）。
 */
export async function compressImageForUpload(
  file: File,
  options?: CompressOptions
): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  const merged = { ...DEFAULT_OPTIONS, ...options };

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: merged.maxSizeMB ?? 1.2,
      maxWidthOrHeight: merged.maxWidthOrHeight ?? 1920,
      useWebWorker: merged.useWebWorker ?? true,
      fileType: 'image/jpeg',
    });
    return compressed;
  } catch (err) {
    console.warn('[compressImageForUpload] fallback to original:', err);
    return file;
  }
}
