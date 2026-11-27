const { onRequest } = require("firebase-functions/v2/https");

const MAX_TEXTS = 40;
const MAX_CHARS = 200;

function isLetter(char) {
  return /\p{L}/u.test(char);
}

function isEmoji(char) {
  return /\p{Extended_Pictographic}/u.test(char)
    || char === "\uFE0F"
    || char === "\u200D"
    || /[\u{1F3FB}-\u{1F3FF}]/u.test(char);
}

function tokenize(raw) {
  const chars = [...String(raw ?? "")];
  const tokens = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < chars.length && /\s/.test(chars[j])) j += 1;
      tokens.push({ type: "space", text: chars.slice(i, j).join("") });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < chars.length && /[0-9]/.test(chars[j])) j += 1;
      tokens.push({ type: "number", text: chars.slice(i, j).join("") });
      i = j;
      continue;
    }
    if (isEmoji(ch)) {
      let j = i + 1;
      while (j < chars.length && isEmoji(chars[j])) j += 1;
      tokens.push({ type: "emoji", text: chars.slice(i, j).join("") });
      i = j;
      continue;
    }
    if (isLetter(ch) || ch === "'" || ch === "’" || ch === "-") {
      let j = i + 1;
      while (j < chars.length && (isLetter(chars[j]) || chars[j] === "'" || chars[j] === "’" || chars[j] === "-")) j += 1;
      tokens.push({ type: "word", text: chars.slice(i, j).join("") });
      i = j;
      continue;
    }
    tokens.push({ type: "mark", text: ch });
    i += 1;
  }
  return tokens;
}

function wordStyle(word) {
  const letters = [...word].filter(isLetter);
  if (!letters.length) return "keep";
  const upper = letters.every((c) => c === c.toLocaleUpperCase("sk") && c !== c.toLocaleLowerCase("sk"));
  const lower = letters.every((c) => c === c.toLocaleLowerCase("sk"));
  if (upper) return "upper";
  if (lower) return "lower";
  const [first, ...rest] = letters;
  if (first === first.toLocaleUpperCase("sk") && rest.every((c) => c === c.toLocaleLowerCase("sk"))) return "title";
  return "mixed";
}

function applyStyle(text, style) {
  if (style === "upper") return text.toLocaleUpperCase("en");
  if (style === "lower") return text.toLocaleLowerCase("en");
  if (style === "title") {
    return text.replace(/\p{L}[\p{L}'’-]*/gu, (word) => {
      const chars = [...word];
      return chars[0].toLocaleUpperCase("en") + chars.slice(1).join("").toLocaleLowerCase("en");
    });
  }
  return text;
}

function phraseStyle(words) {
  const styles = words.map(wordStyle);
  if (!styles.length) return "keep";
  if (styles.every((style) => style === "upper")) return "upper";
  if (styles.every((style) => style === "lower")) return "lower";
  if (styles.every((style) => style === "title")) return "title";
  return styles;
}

function shapeTranslation(raw) {
  const tokens = tokenize(raw);
  const words = tokens.filter((token) => token.type === "word").map((token) => token.text);
  const original = String(raw ?? "").slice(0, MAX_CHARS);
  if (!words.length) {
    return { phrase: "", apply: () => original };
  }
  const style = phraseStyle(words);
  return {
    phrase: words.join(" ").slice(0, MAX_CHARS),
    apply(translated) {
      const styled = applyStyle(String(translated ?? "").trim(), typeof style === "string" ? style : "keep");
      const parts = styled.split(/\s+/).filter(Boolean);
      if (Array.isArray(style) && parts.length === words.length) {
        let n = 0;
        return tokens.map((token) => (token.type === "word" ? applyStyle(parts[n], style[n++]) : token.text)).join("").replace(/[ \t]{2,}/g, " ").trim().slice(0, MAX_CHARS);
      }
      if (typeof style === "string" && parts.length === words.length) {
        let n = 0;
        return tokens.map((token) => (token.type === "word" ? parts[n++] : token.text)).join("").replace(/[ \t]{2,}/g, " ").trim().slice(0, MAX_CHARS);
      }
      const first = tokens.findIndex((token) => token.type === "word");
      let last = -1;
      tokens.forEach((token, index) => {
        if (token.type === "word") last = index;
      });
      const before = tokens.slice(0, first).map((token) => token.text).join("");
      const after = tokens.slice(last + 1).map((token) => token.text).join("");
      const body = typeof style === "string" ? styled : parts.map((part, index) => applyStyle(part, style[Math.min(index, style.length - 1)] || "keep")).join(" ");
      return `${before}${body}${after}`.replace(/[ \t]{2,}/g, " ").trim().slice(0, MAX_CHARS);
    },
  };
}

exports.shapeTranslation = shapeTranslation;

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function googleTranslate(phrases, apiKey) {
  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: phrases,
        source: "sk",
        target: "en",
        format: "text",
      }),
    }
  );
  if (!response.ok) {
    throw new Error("translate");
  }
  const data = await response.json();
  const rows = data?.data?.translations;
  if (!Array.isArray(rows) || rows.length !== phrases.length) {
    throw new Error("translate");
  }
  return rows.map((row) => decodeEntities(row?.translatedText).trim());
}

exports.translateSkEn = onRequest(
  { region: "europe-west1", cors: true, invoker: "public", maxInstances: 5 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST" });
      return;
    }
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Preklad nie je nastavený." });
      return;
    }
    const texts = req.body?.texts;
    if (!Array.isArray(texts) || texts.length > MAX_TEXTS) {
      res.status(400).json({ error: "Najviac 40 textov." });
      return;
    }

    const jobs = texts.map((text) => shapeTranslation(text));
    const translations = jobs.map(() => "");
    const pending = [];
    jobs.forEach((job, index) => {
      if (job.phrase) pending.push({ index, phrase: job.phrase });
      else translations[index] = job.apply("");
    });

    try {
      if (pending.length) {
        const translated = await googleTranslate(pending.map((item) => item.phrase), apiKey);
        pending.forEach((item, i) => {
          translations[item.index] = jobs[item.index].apply(translated[i] || "");
        });
      }
      res.json({ translations });
    } catch (err) {
      console.error("Preklad zlyhal.");
      res.status(502).json({ error: "Preklad sa nepodaril." });
    }
  }
);
