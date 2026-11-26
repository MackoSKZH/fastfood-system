const PRINT_WIDTH = 384; // 58mm papier, 8 dots/mm (203dpi) – zodpovedá MPT-II aj väčšine 58mm tlačiarní
const PADDING_X = 10;
const LINE_H = 38;
const LINE_H_SMALL = 30;
const FEED_ROWS = 50;
const MAX_HEIGHT = 4000;
const MIN_HEIGHT = 480; // aby aj bloček s 1 položkou vyzeral ako "normálny" lístok, nie odstrihnutý útržok

function formatMoney(v) {
  return `${(Number(v) || 0).toFixed(2)} €`;
}

// Niektorí si do názvu položky dajú emoji kvôli rýchlej orientácii v Kase –
// na bločku ho nechceme, len zbytočne zaberá miesto a mätie čiernobielu tlačiareň.
const VARIATION_SELECTOR = "\\uFE0F";
const ZWJ = "\\u200D";
const EMOJI_ZWJ_SEQ = new RegExp(
  `\\p{Extended_Pictographic}(${VARIATION_SELECTOR})?(${ZWJ}\\p{Extended_Pictographic}(${VARIATION_SELECTOR})?)*`,
  "gu"
);
const SKIN_TONE_MODIFIERS = /[\u{1F3FB}-\u{1F3FF}]/gu;
const LEFTOVER_MARKS = new RegExp(`[${VARIATION_SELECTOR}${ZWJ}]`, "g");

function stripEmoji(text) {
  return String(text ?? "")
    .replace(EMOJI_ZWJ_SEQ, "")
    .replace(SKIN_TONE_MODIFIERS, "")
    .replace(LEFTOVER_MARKS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Skúša zmenšovať font (od baseSize po minSize), kým sa text nezmestí do maxWidth.
// Nastaví ctx.font na výsledné veľkosti a vráti ju.
function fitFontSize(ctx, text, maxWidth, baseSize, minSize, prefix = "") {
  let size = baseSize;
  while (size > minSize) {
    ctx.font = `${prefix}${size}px monospace`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }
  ctx.font = `${prefix}${minSize}px monospace`;
  return minSize;
}

// Posledná záchrana pre extrémne dlhý text (napr. jedno neprerušiteľné slovo),
// ktorý sa nezmestí ani pri minimálnej veľkosti písma.
function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "...").width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "...";
}

function wrapTextLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(attempt).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const LOGO_SRC = "/hontfest-logo.jpg"; // musí byť v priečinku public/
const LOGO_WIDTH = 180;
let logoImagePromise = null;

function loadLogoImage() {
  if (!logoImagePromise) {
    logoImagePromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // logo chýba/nedostupné – bloček sa vytlačí aj bez neho
      img.src = LOGO_SRC;
    });
  }
  return logoImagePromise;
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

// order: { nazovPodniku, orderNumber, vysielac, createdAt,
//          riadky: [{ nazov, cena, prilohy: [{ nazov, cena, count }] }],
//          suma, zaplatene, vydaj }
// Vráti canvas orezaný presne na výšku vytlačeného obsahu (bez bieleho prebytku dole).
async function drawReceiptCanvas(order, options = {}) {
  const width = options.width || PRINT_WIDTH;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = MAX_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, MAX_HEIGHT);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  let y = 14;

  const logo = await loadLogoImage();
  if (logo && logo.width > 0) {
    const logoHeight = (logo.height / logo.width) * LOGO_WIDTH;
    ctx.drawImage(logo, (width - LOGO_WIDTH) / 2, y, LOGO_WIDTH, logoHeight);
    y += logoHeight + 12;
  }

  const nadpis = order.nazovPodniku || "Bloček";
  ctx.textAlign = "center";
  fitFontSize(ctx, nadpis, width - PADDING_X * 2, 32, 20, "bold ");
  ctx.fillText(nadpis, width / 2, y);
  y += 46;

  ctx.font = "20px monospace";
  ctx.textAlign = "center";
  if (order.createdAt) {
    ctx.fillText(new Date(order.createdAt).toLocaleString("sk-SK"), width / 2, y);
    y += LINE_H_SMALL;
  }
  if (order.vysielac != null && order.vysielac !== "") {
    ctx.fillText(`Objednávka #${order.orderNumber ?? "-"} - Pípač #${order.vysielac}`, width / 2, y);
    y += LINE_H_SMALL + 8;
  } else {
    const numberText = `Objednávka #${order.orderNumber ?? "-"}`;
    fitFontSize(ctx, numberText, width - PADDING_X * 2, 64, 36, "bold ");
    ctx.textAlign = "center";
    ctx.fillText(numberText, width / 2, y);
    y += 78;
  }

  drawDivider(ctx, y, width);
  y += 20;

  (order.riadky || []).forEach((r) => {
    ctx.font = "24px monospace";
    const nazov = stripEmoji(r.nazov);
    const priceText = formatMoney(r.cena);
    const priceWidth = ctx.measureText(priceText).width;
    const fullWidth = width - PADDING_X * 2;
    const nameMaxWidth = fullWidth - priceWidth - 10;

    if (ctx.measureText(nazov).width <= nameMaxWidth) {
      // zmestí sa na jeden riadok spolu s cenou
      ctx.textAlign = "left";
      ctx.fillText(nazov, PADDING_X, y);
      ctx.textAlign = "right";
      ctx.fillText(priceText, width - PADDING_X, y);
      y += LINE_H;
    } else {
      // dlhý názov – zalomí sa na viac riadkov (pevná veľkosť písma), cena na vlastnom riadku pod tým
      ctx.textAlign = "left";
      wrapTextLines(ctx, nazov, fullWidth).forEach((line) => {
        ctx.fillText(line, PADDING_X, y);
        y += LINE_H;
      });
      ctx.textAlign = "right";
      ctx.fillText(priceText, width - PADDING_X, y);
      y += LINE_H;
    }

    (r.prilohy || []).forEach((p) => {
      const label = `- ${p.count > 1 ? `${p.count}x ` : ""}${stripEmoji(p.nazov)}`;
      ctx.font = "19px monospace";
      let priceStr = "";
      let priceW = 0;
      if (p.cena) {
        priceStr = formatMoney(p.cena * (p.count || 1));
        priceW = ctx.measureText(priceStr).width;
      }
      const labelMaxWidth = width - PADDING_X * 2 - 16 - priceW - 10;
      fitFontSize(ctx, label, labelMaxWidth, 19, 12);
      ctx.textAlign = "left";
      ctx.fillText(truncateToWidth(ctx, label, labelMaxWidth), PADDING_X + 16, y);
      if (priceStr) {
        ctx.font = "19px monospace";
        ctx.textAlign = "right";
        ctx.fillText(priceStr, width - PADDING_X, y);
      }
      y += LINE_H_SMALL;
      ctx.font = "24px monospace";
    });
  });

  y += 8;
  drawDivider(ctx, y, width);
  y += 24;

  ctx.font = "bold 26px monospace";
  y = drawKeyValue(ctx, "Spolu", formatMoney(order.suma), y, width);
  if (order.zaplatene != null) {
    ctx.font = "22px monospace";
    y = drawKeyValue(ctx, "Zaplatené", formatMoney(order.zaplatene), y, width);
    y = drawKeyValue(ctx, "Vydané", formatMoney(order.vydaj), y, width);
  }

  y += 16;
  drawDivider(ctx, y, width);
  y += 22;

  ctx.font = "bold italic 22px monospace";
  ctx.textAlign = "center";
  wrapTextLines(ctx, "Touto kúpou podporujete v plnej sume organizáciu festivalu", width - PADDING_X * 2).forEach((line) => {
    ctx.fillText(line, width / 2, y);
    y += LINE_H;
  });

  y += 6;
  ctx.font = "bold 24px monospace";
  ctx.fillText("Ďakujeme :)", width / 2, y);
  y += LINE_H;

  y += FEED_ROWS;

  const contentHeight = Math.max(Math.min(Math.ceil(y), MAX_HEIGHT), MIN_HEIGHT);
  const cropped = document.createElement("canvas");
  cropped.width = width;
  cropped.height = contentHeight;
  cropped.getContext("2d").drawImage(canvas, 0, 0);
  return cropped;
}

// order → canvas orezaný na výšku obsahu, pripravený na PNG export/tlač.
export async function renderReceipt(order, options) {
  return drawReceiptCanvas(order, options);
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
