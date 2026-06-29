export const AVATAR_MAX_RAW_BYTES = 5 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 400;
export const AVATAR_TARGET_MAX_BYTES = 100 * 1024;

const ACCEPTED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ACCEPTED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function isAcceptedAvatarFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (ACCEPTED_MIME.has(mime)) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return Boolean(ext && ACCEPTED_EXT.has(ext));
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片解码失败'));
    };
    img.src = objectUrl;
  });
}

function centerCropSquare(img: HTMLImageElement) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const side = Math.min(w, h);
  return {
    sx: (w - side) / 2,
    sy: (h - side) / 2,
    sw: side,
    sh: side,
  };
}

function drawAvatarCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const { sx, sy, sw, sh } = centerCropSquare(img);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出失败'))),
      mime,
      quality
    );
  });
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * 中心裁剪为 1:1，输出 400×400 JPEG，质量阶梯压缩至约 100KB 以内。
 */
export async function processAvatarImage(file: File): Promise<Blob> {
  await yieldToMain();
  const img = await loadImageFromFile(file);
  await yieldToMain();
  const canvas = drawAvatarCanvas(img);

  const qualities = [0.82, 0.76, 0.7, 0.64, 0.58, 0.52];
  let smallest: Blob | null = null;

  for (const quality of qualities) {
    await yieldToMain();
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= AVATAR_TARGET_MAX_BYTES) return blob;
  }

  if (smallest) return smallest;
  throw new Error('头像压缩失败');
}

export function avatarBlobToFile(blob: Blob): File {
  return new File([blob], `avatar-${Date.now()}.jpg`, {
    type: blob.type || 'image/jpeg',
  });
}
