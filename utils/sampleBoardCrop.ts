/** 样板图矩阵裁剪：色块区 + 底部色号条（与色块同格划分） */

export type SampleSwatchCrop = {
  row: number;
  col: number;
  imagePng: string;
  dominantHex: string;
};

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("样板图加载失败"));
    img.src = dataUrl;
  });
}

function averageColorFromCanvas(c: HTMLCanvasElement): string {
  const ctx = c.getContext("2d");
  if (!ctx) return "#888888";
  const w = Math.min(32, c.width);
  const h = Math.min(32, c.height);
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");
  if (!tctx) return "#888888";
  tctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
  const { data } = tctx.getImageData(0, 0, w, h);
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 16) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return "#888888";
  const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * @param labelStripRatio 底部色号/文字区域占整图高度比例（约 0.12–0.22）
 */
export async function cropSampleBoardGrid(
  imageDataUrl: string,
  opts: { rows: number; cols: number; labelStripRatio: number }
): Promise<SampleSwatchCrop[]> {
  const { rows, cols, labelStripRatio } = opts;
  if (rows < 1 || cols < 1) throw new Error("行列数须 ≥ 1");
  const ratio = Math.min(0.45, Math.max(0.05, labelStripRatio));

  const img = await loadImage(imageDataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const gridH = H * (1 - ratio);
  const cellW = W / cols;
  const cellH = gridH / rows;
  const labelStripH = H - gridH;
  const labelCellH = labelStripH / rows;

  const out: SampleSwatchCrop[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * cellW;
      const sy = r * cellH;
      const cw = Math.round(cellW);
      const ch = Math.round(cellH);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, cw);
      canvas.height = Math.max(1, ch);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, canvas.width, canvas.height);
      const dominantHex = averageColorFromCanvas(canvas);
      out.push({
        row: r,
        col: c,
        imagePng: canvas.toDataURL("image/png"),
        dominantHex,
      });
    }
  }

  return out;
}

/** 裁出底部色号条整图，供视觉模型识别 */
export async function extractLabelStripDataUrl(
  imageDataUrl: string,
  labelStripRatio: number
): Promise<string> {
  const img = await loadImage(imageDataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const ratio = Math.min(0.45, Math.max(0.05, labelStripRatio));
  const gridH = H * (1 - ratio);
  const stripH = H - gridH;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.max(1, Math.round(stripH));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, gridH, W, stripH, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}
