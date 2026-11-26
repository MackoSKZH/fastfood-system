const CHUNK = 40;

export async function translateSkToEn(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text ?? ""));
  if (!list.length) return [];
  const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Preklad sa nepodaril.");
  const url = `https://europe-west1-${projectId}.cloudfunctions.net/translateSkEn`;
  const out = [];
  for (let start = 0; start < list.length; start += CHUNK) {
    const chunk = list.slice(start, start + CHUNK);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: chunk }),
    });
    if (!response.ok) throw new Error("Preklad sa nepodaril.");
    const data = await response.json();
    if (!Array.isArray(data.translations) || data.translations.length !== chunk.length) {
      throw new Error("Preklad sa nepodaril.");
    }
    out.push(...data.translations.map((text) => String(text ?? "").trim()));
  }
  return out;
}
