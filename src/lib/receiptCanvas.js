import { PRINT_WIDTH } from "./catPrinterBLE";

const PADDING_X = 8;
const LINE_H = 24;
const LINE_H_SMALL = 20;
const FEED_ROWS = 40;
const MAX_HEIGHT = 4000;
const DARK_THRESHOLD = 200;

function formatMoney(v) {
  return `${(Number(v) || 0).toFixed(2)} €`;
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

function drawDivider(ctx, y, width) {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(4, y + 0.5);
  ctx.lineTo(width - 4, y + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawKeyValue(ctx, label, value, y, width) {
  ctx.textAlign = "left";
  ctx.fillText(label, PADDING_X, y);
  ctx.textAlign = "right";
  ctx.fillText(value, width - PADDING_X, y);
  return y + LINE_H;
}

// imageData: { data: Uint8ClampedArray (RGBA), width, height } – rozoberateľné aj bez reálneho canvasu (testovateľné).
export function imageDataToRows(imageData, width, height) {
  const { data } = imageData;
  const rows = [];
  for (let yRow = 0; yRow < height; yRow++) {
    const row = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const idx = (yRow * width + x) * 4;
      const a = data[idx + 3];
      const luminance = a === 0 ? 255 : (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      row[x] = luminance < DARK_THRESHOLD ? 1 : 0;
    }
    rows.push(row);
  }
  return rows;
}

// order: { nazovPodniku, orderNumber, vysielac, createdAt,
//          riadky: [{ nazov, cena, prilohy: [{ nazov, cena, count }] }],
//          suma, zaplatene, vydaj }
// Vráti canvas orezaný presne na výšku vytlačeného obsahu (bez bieleho prebytku dole).
function drawReceiptCanvas(order) {
  const width = PRINT_WIDTH;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = MAX_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, MAX_HEIGHT);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  let y = 10;

  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.fillText(order.nazovPodniku || "Bloček", width / 2, y);
  y += 30;

  ctx.font = "13px monospace";
  ctx.textAlign = "center";
  if (order.createdAt) {
    ctx.fillText(new Date(order.createdAt).toLocaleString("sk-SK"), width / 2, y);
    y += LINE_H_SMALL;
  }
  ctx.fillText(`Objednávka #${order.orderNumber ?? "—"} · Pípač #${order.vysielac ?? "—"}`, width / 2, y);
  y += LINE_H_SMALL + 6;

  drawDivider(ctx, y, width);
  y += 14;

  ctx.font = "15px monospace";
  (order.riadky || []).forEach((r) => {
    const priceText = formatMoney(r.cena);
    const nameMaxWidth = width - PADDING_X * 2 - ctx.measureText(priceText).width - 10;
    ctx.textAlign = "left";
    ctx.fillText(truncateToWidth(ctx, r.nazov, nameMaxWidth), PADDING_X, y);
    ctx.textAlign = "right";
    ctx.fillText(priceText, width - PADDING_X, y);
    y += LINE_H;

    (r.prilohy || []).forEach((p) => {
      ctx.font = "13px monospace";
      const label = `↳ ${p.count > 1 ? `${p.count}× ` : ""}${p.nazov}`;
      ctx.textAlign = "left";
      ctx.fillText(label, PADDING_X + 14, y);
      if (p.cena) {
        ctx.textAlign = "right";
        ctx.fillText(formatMoney(p.cena * (p.count || 1)), width - PADDING_X, y);
      }
      y += LINE_H_SMALL;
      ctx.font = "15px monospace";
    });
  });

  y += 6;
  drawDivider(ctx, y, width);
  y += 16;

  ctx.font = "bold 16px monospace";
  y = drawKeyValue(ctx, "Spolu", formatMoney(order.suma), y, width);
  ctx.font = "15px monospace";
  y = drawKeyValue(ctx, "Zaplatené", formatMoney(order.zaplatene), y, width);
  y = drawKeyValue(ctx, "Vydané", formatMoney(order.vydaj), y, width);

  y += FEED_ROWS;

  const contentHeight = Math.min(Math.ceil(y), MAX_HEIGHT);
  const cropped = document.createElement("canvas");
  cropped.width = width;
  cropped.height = contentHeight;
  cropped.getContext("2d").drawImage(canvas, 0, 0);
  return cropped;
}

// order → { rows, canvas } – rows sú pre tlačiareň (BLE bitmapa), canvas je orezaný
// obrázok bločku vhodný napr. na PNG export.
export function renderReceipt(order) {
  const canvas = drawReceiptCanvas(order);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rows = imageDataToRows(imageData, canvas.width, canvas.height);
  return { rows, canvas };
}

// Tichy download canvasu ako PNG (bez dialógu) – použije sa napr. na archiváciu bločku.
export function saveCanvasPngSilently(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      resolve(true);
    }, "image/png");
  });
}
