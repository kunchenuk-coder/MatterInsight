import QRCode from "qrcode";

export type MaterialCardComposeInput = {
  swatchDataUrl: string;
  materialPageUrl: string;
  title: string;
  subtitle?: string;
};

const CARD_W = 420;
const CARD_H = 520;

export async function composeMaterialMarketingCard(
  input: MaterialCardComposeInput
): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(input.materialPageUrl, {
    width: 112,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return input.swatchDataUrl;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, CARD_W, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("物见 MATTER INSIGHT", 20, 28);

  const img = await loadImage(input.swatchDataUrl);
  const imgBoxX = 24;
  const imgBoxY = 72;
  const imgBoxW = CARD_W - 48;
  const imgBoxH = 300;
  ctx.save();
  roundRectPath(ctx, imgBoxX, imgBoxY, imgBoxW, imgBoxH, 12);
  ctx.clip();
  const scale = Math.max(imgBoxW / img.width, imgBoxH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = imgBoxX + (imgBoxW - dw) / 2;
  const dy = imgBoxY + (imgBoxH - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  roundRectPath(ctx, imgBoxX + 0.5, imgBoxY + 0.5, imgBoxW - 1, imgBoxH - 1, 12);
  ctx.stroke();

  ctx.fillStyle = "#111827";
  ctx.font = "bold 15px Inter, system-ui, sans-serif";
  wrapText(ctx, input.title, 24, 392, CARD_W - 160, 22, 3);

  if (input.subtitle) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px Inter, system-ui, sans-serif";
    wrapText(ctx, input.subtitle, 24, 448, CARD_W - 160, 18, 2);
  }

  const qrImg = await loadImage(qrDataUrl);
  const qrX = CARD_W - 24 - 112;
  const qrY = CARD_H - 24 - 112;
  ctx.drawImage(qrImg, qrX, qrY, 112, 112);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "9px Inter, system-ui, sans-serif";
  ctx.fillText("扫码查看", qrX, qrY - 14);

  return canvas.toDataURL("image/png");
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("图片加载失败"));
    i.src = dataUrl;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const words = text.split(/(\s+)/);
  let line = "";
  let cy = y;
  let lines = 0;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n];
    const w = ctx.measureText(test).width;
    if (w > maxWidth && line.length > 0) {
      ctx.fillText(line, x, cy);
      line = words[n].trimStart();
      cy += lineHeight;
      lines++;
      if (lines >= maxLines) {
        ctx.fillText(line.slice(0, 20) + "…", x, cy);
        return;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}
