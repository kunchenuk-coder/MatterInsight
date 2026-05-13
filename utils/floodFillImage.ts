/** 8 连通域：在 RGBA 图像上从种子点按颜色容差扩展，返回二值掩码（1=选中） */

type RGB = [number, number, number];

function rgbAt(data: Uint8ClampedArray, w: number, x: number, y: number): RGB {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function colorDist2(a: RGB, b: RGB): number {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** 从起点 BFS，像素颜色与固定 seedColor 比较（用于自适应抠图的中位色种子） */
export function floodFillMaskFixedColor(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  startX: number,
  startY: number,
  seedColor: RGB,
  tolSq: number
): Uint8Array {
  const sx = Math.max(0, Math.min(w - 1, Math.floor(startX)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(startY)));
  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let qh = 0,
    qt = 0;
  mask[sy * w + sx] = 1;
  qx[qt] = sx;
  qy[qt] = sy;
  qt++;
  while (qh < qt) {
    const x = qx[qh],
      y = qy[qh];
    qh++;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni]) continue;
        if (colorDist2(rgbAt(data, w, nx, ny), seedColor) > tolSq) continue;
        mask[ni] = 1;
        qx[qt] = nx;
        qy[qt] = ny;
        qt++;
      }
    }
  }
  return mask;
}

export function floodFillMaskFromSeed(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seedX: number,
  seedY: number,
  tolSq: number
): Uint8Array {
  const sx = Math.max(0, Math.min(w - 1, Math.floor(seedX)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(seedY)));
  const seed = rgbAt(data, w, sx, sy);
  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let qh = 0,
    qt = 0;
  mask[sy * w + sx] = 1;
  qx[qt] = sx;
  qy[qt] = sy;
  qt++;
  while (qh < qt) {
    const x = qx[qh],
      y = qy[qh];
    qh++;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni]) continue;
        if (colorDist2(rgbAt(data, w, nx, ny), seed) > tolSq) continue;
        mask[ni] = 1;
        qx[qt] = nx;
        qy[qt] = ny;
        qt++;
      }
    }
  }
  return mask;
}

/** 掩码白色区域的最小外接轴对齐矩形（像素坐标 inclusive） */
export function boundingBoxOfMask(mask: Uint8Array, w: number, h: number): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY };
}
