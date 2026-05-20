/** 全站上传压缩长边上限，减轻 localStorage 压力 */
export const UPLOAD_MAX_WIDTH = 1920;
export const MOODBOARD_IMAGE_MAX_WIDTH = 1920;
export const MOODBOARD_IMAGE_QUALITY = 0.72;
export const AI_MODAL_IMAGE_MAX_WIDTH = 1920;
export const AI_MODAL_IMAGE_QUALITY = 0.78;

/** 情绪板右键「本地材料」：长边上限与 JPEG 质量区间 */
export const LOCAL_CANVAS_MATERIAL_MAX_LONG_EDGE = 800;
export const LOCAL_CANVAS_MATERIAL_TARGET_MAX_BYTES = 100 * 1024;
const LOCAL_CANVAS_MATERIAL_QUALITIES = [0.7, 0.65, 0.6, 0.55] as const;

export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.ceil((base64.length * 3) / 4);
}

function scaleToMaxLongEdge(
  width: number,
  height: number,
  maxLongEdge: number
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxLongEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxLongEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encodeImageToJpegDataUrl(img: HTMLImageElement, maxLongEdge: number, quality: number): string {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (w0 < 1 || h0 < 1) throw new Error("无效图片尺寸");
  const { width, height } = scaleToMaxLongEdge(w0, h0, maxLongEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 不可用");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 按长边缩放并输出 JPEG data URL */
export function compressFileToDataUrlLongEdge(
  file: File,
  maxLongEdge = LOCAL_CANVAS_MATERIAL_MAX_LONG_EDGE,
  quality = 0.68
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const src = event.target?.result as string;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          resolve(encodeImageToJpegDataUrl(img, maxLongEdge, quality));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = src;
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * 右键上传本地材料专用：长边 ≤800px、JPEG、体积约 50–100KB。
 */
export async function compressImage(file: File): Promise<string> {
  for (const q of LOCAL_CANVAS_MATERIAL_QUALITIES) {
    const url = await compressFileToDataUrlLongEdge(file, LOCAL_CANVAS_MATERIAL_MAX_LONG_EDGE, q);
    if (dataUrlByteSize(url) <= LOCAL_CANVAS_MATERIAL_TARGET_MAX_BYTES) {
      return url;
    }
  }
  const fallback = await compressFileToDataUrlLongEdge(file, 640, 0.55);
  if (dataUrlByteSize(fallback) > LOCAL_CANVAS_MATERIAL_TARGET_MAX_BYTES * 1.5) {
    throw new Error("IMAGE_TOO_LARGE_AFTER_COMPRESS");
  }
  return fallback;
}

/** 将 File 压成 JPEG data URL，控制 localStorage / AI 请求体积 */
export function compressFileToDataUrl(
  file: File,
  maxWidth = UPLOAD_MAX_WIDTH,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const src = event.target?.result as string;
      compressDataUrl(src, maxWidth, quality).then(resolve).catch(reject);
    };
    reader.onerror = (err) => reject(err);
  });
}

/** 将已有 data URL（可能极大）再压一遍，用于 AI 上传前 / 写入情绪板前 */
export function compressDataUrl(
  dataUrl: string,
  maxWidth = UPLOAD_MAX_WIDTH,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width < 1 || height < 1) {
          resolve(dataUrl);
          return;
        }
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

/** 仅按质量重编码为 JPEG，不改变像素宽高（用于上传体积压缩） */
export function reencodeDataUrlSameDimensions(dataUrl: string, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = Math.round(img.naturalWidth || img.width);
        const h = Math.round(img.naturalHeight || img.height);
        if (w < 1 || h < 1) {
          resolve(dataUrl);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

export function reencodeFileToDataUrl(file: File, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      reencodeDataUrlSameDimensions(src, quality).then(resolve).catch(reject);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
  });
}

/** 在不超过 maxWidth×maxHeight 的框内按比例缩放，用于画布占位（不裁切原图比例） */
export function measureDataUrlContainedBox(
  dataUrl: string,
  maxWidth: number,
  maxHeight: number
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      if (w0 < 1 || h0 < 1) {
        resolve({ width: Math.min(maxWidth, 600), height: Math.min(maxHeight, 400) });
        return;
      }
      const scale = Math.min(maxWidth / w0, maxHeight / h0, 1);
      resolve({
        width: Math.max(1, Math.round(w0 * scale)),
        height: Math.max(1, Math.round(h0 * scale)),
      });
    };
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = dataUrl;
  });
}

/** 将 PNG/WebP 等 Blob 压成 JPEG data URL（用于审核流写入 JSON，高清原片可仅存 IndexedDB） */
export function compressBlobToDataUrl(
  blob: Blob,
  maxWidth = UPLOAD_MAX_WIDTH,
  quality = 0.78
): Promise<string> {
  const objUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (width < 1 || height < 1) {
          reject(new Error("无效图片尺寸"));
          return;
        }
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 不可用"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error("Blob 解码失败"));
    };
    img.src = objUrl;
  });
}
