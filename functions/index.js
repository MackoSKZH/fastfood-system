const { onRequest } = require("firebase-functions/v2/https");

const MAX_TEXTS = 40;
const MAX_CHARS = 200;

function phraseForTranslation(raw) {
  let text = String(raw ?? "");
  text = text.replace(/\p{Extended_Pictographic}/gu, "");
  text = text.replace(/[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, "");
  text = text.replace(/^\s*\d+\s*/, "");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_CHARS);
}

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

    const phrases = texts.map(phraseForTranslation);
    const translations = phrases.map(() => "");
    const pending = [];
    phrases.forEach((phrase, index) => {
      if (phrase) pending.push({ index, phrase });
    });

    try {
      if (pending.length) {
        const translated = await googleTranslate(pending.map((item) => item.phrase), apiKey);
        pending.forEach((item, i) => {
          translations[item.index] = translated[i] || "";
        });
      }
      res.json({ translations });
    } catch (err) {
      console.error("Preklad zlyhal.");
      res.status(502).json({ error: "Preklad sa nepodaril." });
    }
  }
);
