// Stabilné ID tohto konkrétneho zariadenia/prehliadača (nie používateľa) – potrebné na to,
// aby appka vedela rozlíšiť "ja to beriem" od "berie to niekto iný" pri zdieľanej session
// naprieč viacerými telefónmi/tabletmi obsluhy.
const KEY = "ff_clientId";
let cached = null;

export function getClientId() {
  if (cached) return cached;
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, id);
  }
  cached = id;
  return id;
}
