/**
 * 自适应样块抠图：颜色容差 + 8 连通域 → 形态学闭运算收边 → 凸包 + 最小面积外接矩形 → 透视矫正。
 */

import { floodFillMaskFixedColor } from "./floodFillImage";

export type MattingProgressFn = (fraction: number, stage: string) => void;

type RGB = [number, number, number];
type Pt = { x: number; y: number };

function rgbAt(data: Uint8ClampedArray, w: number, x: number, y: number): RGB {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function medianSeedColor(data: Uint8ClampedArray, w: number, h: number, rad = 6): RGB {
  const cx = Math.floor(w / 2),
    cy = Math.floor(h / 2);
  const rs: number[] = [],
    gs: number[] = [],
    bs: number[] = [];
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const x = cx + dx,
        y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const [r, g, b] = rgbAt(data, w, x, y);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  const med = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] ?? 0;
  };
  return [med(rs), med(gs), med(bs)];
}

function morphCloseBinary(mask: Uint8Array, w: number, h: number, iterations: number): void {
  const tmp = new Uint8Array(w * h);
  for (let it = 0; it < iterations; it++) {
    tmp.set(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!tmp[i]) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!tmp[(y + dy) * w + (x + dx)]) {
              ok = false;
              break;
            }
          }
        }
        mask[i] = ok ? 1 : 0;
      }
    }
    tmp.set(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (tmp[i]) {
          mask[i] = 1;
          continue;
        }
        let any = false;
        for (let dy = -1; dy <= 1 && !any; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (tmp[(y + dy) * w + (x + dx)]) {
              any = true;
              break;
            }
          }
        }
        mask[i] = any ? 1 : 0;
      }
    }
  }
}

function collectBoundaryPoints(mask: Uint8Array, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let border = false;
      for (let dy = -1; dy <= 1 && !border; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!mask[(y + dy) * w + (x + dx)]) {
            border = true;
            break;
          }
        }
      }
      if (border) pts.push({ x, y });
    }
  }
  if (pts.length > 10000) {
    const step = Math.ceil(pts.length / 10000);
    const thin: Pt[] = [];
    for (let i = 0; i < pts.length; i += step) thin.push(pts[i]);
    return thin;
  }
  return pts;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function rotate(p: Pt, origin: Pt, angle: number): Pt {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const dx = p.x - origin.x,
    dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

function minAreaQuad(hull: Pt[]): Pt[] | null {
  if (hull.length < 3) return null;
  let bestArea = Infinity;
  let bestCorners: Pt[] | null = null;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const p0 = hull[i],
      p1 = hull[(i + 1) % n];
    const angle = -Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const rot = hull.map((p) => rotate(p, p0, angle));
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of rot) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < 1 || !Number.isFinite(area)) continue;
    if (area < bestArea) {
      bestArea = area;
      bestCorners = [
        rotate({ x: minX, y: minY }, p0, -angle),
        rotate({ x: maxX, y: minY }, p0, -angle),
        rotate({ x: maxX, y: maxY }, p0, -angle),
        rotate({ x: minX, y: maxY }, p0, -angle),
      ];
    }
  }
  return bestCorners;
}

function orderQuadTLTRBRBL(pts: Pt[]): Pt[] {
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bot[1], bot[0]];
}

function homographyFrom4(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const xp = dst[i].x,
      yp = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -xp * x, -xp * y]);
    b.push(xp);
    A.push([0, 0, 0, x, y, 1, -yp * x, -yp * y]);
    b.push(yp);
  }
  const sol = solveLinear8(A, b);
  if (!sol) return null;
  return [...sol, 1];
}

function solveLinear8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (Math.abs(f) < 1e-14) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function invert3x3(m: number[]): number[] | null {
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = m;
  const det =
    a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    (a11 * a22 - a12 * a21) * invDet,
    (a02 * a21 - a01 * a22) * invDet,
    (a01 * a12 - a02 * a11) * invDet,
    (a12 * a20 - a10 * a22) * invDet,
    (a00 * a22 - a02 * a20) * invDet,
    (a02 * a10 - a00 * a12) * invDet,
    (a10 * a21 - a11 * a20) * invDet,
    (a01 * a20 - a00 * a21) * invDet,
    (a00 * a11 - a01 * a10) * invDet,
  ];
}

function applyH(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  if (Math.abs(w) < 1e-9) return { x: 0, y: 0 };
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

function bilinearRGBA(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const idx = (yy: number, xx: number) => (yy * w + xx) * 4;
  const s = (ii: number) => [data[ii], data[ii + 1], data[ii + 2], data[ii + 3]];
  const c0 = s(idx(y0, x0)),
    c1 = s(idx(y0, x0 + 1)),
    c2 = s(idx(y0 + 1, x0)),
    c3 = s(idx(y0 + 1, x0 + 1));
  const o: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    o[k] = (1 - fx) * (1 - fy) * c0[k] + fx * (1 - fy) * c1[k] + (1 - fx) * fy * c2[k] + fx * fy * c3[k];
  }
  return o;
}

function maskValue(mask: Uint8Array, mw: number, mh: number, x: number, y: number): number {
  const xi = Math.round(x),
    yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= mw || yi >= mh) return 0;
  return mask[yi * mw + xi] ? 1 : 0;
}

export type AdaptiveMattingOptions = {
  tolerance: number;
  maxWorkSide: number;
  /** 原图像素坐标；若提供则从该点邻域取参考色并作为洪水填充起点 */
  seedPixel?: { x: number; y: number };
};

const defaultOptions: AdaptiveMattingOptions = {
  tolerance: 38,
  maxWorkSide: 720,
};

export async function runAdaptiveMatting(
  sourceCanvas: HTMLCanvasElement,
  options: Partial<AdaptiveMattingOptions> = {},
  onProgress?: MattingProgressFn
): Promise<string> {
  const opt = { ...defaultOptions, ...options };
  const srcW = sourceCanvas.width,
    srcH = sourceCanvas.height;
  if (srcW < 8 || srcH < 8) throw new Error("图像过小");

  const report = (f: number, s: string) => onProgress?.(f, s);

  report(0.05, "读取像素");
  await new Promise((r) => requestAnimationFrame(r));

  const scale = Math.min(1, opt.maxWorkSide / Math.max(srcW, srcH));
  const w = Math.max(8, Math.round(srcW * scale));
  const h = Math.max(8, Math.round(srcH * scale));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const wctx = work.getContext("2d");
  if (!wctx) throw new Error("Canvas2D 不可用");
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = "high";
  wctx.drawImage(sourceCanvas, 0, 0, w, h);
  const imgData = wctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  report(0.2, "连通域分析");
  const sx = opt.seedPixel
    ? Math.max(0, Math.min(w - 1, Math.round(opt.seedPixel.x * scale)))
    : Math.floor(w / 2);
  const sy = opt.seedPixel
    ? Math.max(0, Math.min(h - 1, Math.round(opt.seedPixel.y * scale)))
    : Math.floor(h / 2);
  const seedRgb = opt.seedPixel ? rgbAt(data, w, sx, sy) : medianSeedColor(data, w, h, 5);
  const tolSq = opt.tolerance * opt.tolerance * 3;
  const mask = floodFillMaskFixedColor(data, w, h, sx, sy, seedRgb, tolSq);

  report(0.38, "边缘吸附");
  morphCloseBinary(mask, w, h, 2);

  report(0.52, "角点 / 凸包");
  const bpts = collectBoundaryPoints(mask, w, h);
  const srcCtx = sourceCanvas.getContext("2d");
  if (!srcCtx) throw new Error("源 Canvas 无效");
  const srcRGBA = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const fallbackAabb = (): string => {
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
    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    const cw = Math.max(1, maxX - minX + 1),
      ch = Math.max(1, maxY - minY + 1);
    const out = document.createElement("canvas");
    out.width = Math.round(cw / scale);
    out.height = Math.round(ch / scale);
    const o = out.getContext("2d")!;
    o.drawImage(sourceCanvas, minX / scale, minY / scale, cw / scale, ch / scale, 0, 0, out.width, out.height);
    report(1, "完成");
    return out.toDataURL("image/png");
  };

  if (bpts.length < 12) {
    report(0.9, "回退轴对齐");
    return fallbackAabb();
  }

  const hull = convexHull(bpts);
  const quad = minAreaQuad(hull);
  if (!quad) {
    report(0.9, "回退轴对齐");
    return fallbackAabb();
  }

  const orderedWork = orderQuadTLTRBRBL(quad);
  const orderedSrc: Pt[] = orderedWork.map((p) => ({ x: p.x / scale, y: p.y / scale }));

  const dstW = Math.max(
    24,
    Math.hypot(orderedSrc[1].x - orderedSrc[0].x, orderedSrc[1].y - orderedSrc[0].y),
    Math.hypot(orderedSrc[3].x - orderedSrc[0].x, orderedSrc[3].y - orderedSrc[0].y)
  );
  const dstH = Math.max(
    24,
    Math.hypot(orderedSrc[2].x - orderedSrc[1].x, orderedSrc[2].y - orderedSrc[1].y),
    Math.hypot(orderedSrc[2].x - orderedSrc[3].x, orderedSrc[2].y - orderedSrc[3].y)
  );

  const dstQuad: Pt[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  report(0.65, "透视矩阵");
  const H = homographyFrom4(orderedSrc, dstQuad);
  if (!H) {
    report(0.9, "回退轴对齐");
    return fallbackAabb();
  }
  const Hinv = invert3x3(H);
  if (!Hinv) {
    report(0.9, "回退轴对齐");
    return fallbackAabb();
  }

  report(0.75, "透视矫正");
  const maxSide = 1600;
  const outScale = Math.min(1, maxSide / Math.max(dstW, dstH));
  const outW = Math.max(1, Math.ceil(dstW * outScale));
  const outH = Math.max(1, Math.ceil(dstH * outScale));
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const octx = outCanvas.getContext("2d");
  if (!octx) throw new Error("Canvas2D");
  const outImg = octx.createImageData(outW, outH);
  const od = outImg.data;

  const mw = w,
    mh = h;
  const rowStride = 24;
  for (let y0 = 0; y0 < outH; y0 += rowStride) {
    const y1 = Math.min(outH, y0 + rowStride);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < outW; x++) {
        const xd = x / outScale,
          yd = y / outScale;
        const p = applyH(Hinv, xd, yd);
        const [r, g, b, a0] = bilinearRGBA(srcRGBA, srcW, srcH, p.x, p.y);
        const inside = maskValue(mask, mw, mh, p.x * scale, p.y * scale);
        const a = Math.round(a0 * (inside ? 1 : 0.08));
        const oi = (y * outW + x) * 4;
        od[oi] = r;
        od[oi + 1] = g;
        od[oi + 2] = b;
        od[oi + 3] = a;
      }
    }
    report(0.75 + (0.22 * y1) / outH, "透视采样");
    await new Promise((r) => requestAnimationFrame(r));
  }
  octx.putImageData(outImg, 0, 0);

  report(1, "完成");
  return outCanvas.toDataURL("image/png");
}
