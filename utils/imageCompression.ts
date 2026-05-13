/** 全站上传压缩长边上限，减轻 localStorage 压力 */
export const UPLOAD_MAX_WIDTH = 1920;
export const MOODBOARD_IMAGE_MAX_WIDTH = 1920;
export const MOODBOARD_IMAGE_QUALITY = 0.72;
export const AI_MODAL_IMAGE_MAX_WIDTH = 1920;
export const AI_MODAL_IMAGE_QUALITY = 0.78;

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
