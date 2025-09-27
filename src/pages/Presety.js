import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { ref, set, onValue, remove } from "firebase/database";
import { useNavigate } from "react-router-dom";
import "./kiosk.css";

export default function Presety() {
  const navigate = useNavigate();

  const [presety, setPresety] = useState({});
  const [vybranyPreset, setVybranyPreset] = useState("");
  const [nazovPresetu, setNazovPresetu] = useState("");
  const [novaPolozka, setNovaPolozka] = useState({ nazov: "", cena: "" });
  const [editRadok, setEditRadok] = useState(null);
  const [novyPresetOpen, setNovyPresetOpen] = useState(false);

  useEffect(() => {
    const refPresets = ref(db, "presets");
    const off = onValue(refPresets, (snap) => setPresety(snap.val() || {}));
    return () => off();
  }, []);

  useEffect(() => {
    const ulozeny = sessionStorage.getItem("vybranyPreset");
    if (ulozeny && (presety[ulozeny] || ulozeny === "")) setVybranyPreset(ulozeny);
  }, [presety]);
  useEffect(() => {
    sessionStorage.setItem("vybranyPreset", vybranyPreset || "");
  }, [vybranyPreset]);

  const polozky = useMemo(() => {
    const p = presety[vybranyPreset] || {};
    return Object.entries(p)
      .map(([nazov, v]) => ({ nazov, cena: Number(v?.cena ?? 0) }))
      .sort((a, b) => a.nazov.localeCompare(b.nazov, "sk"));
  }, [presety, vybranyPreset]);

  const hasForbidden = (s) => /[.#$/[\]]/.test(s);
  const trimText = (s) => s.trim();

  async function vytvorPreset() {
    const raw = nazovPresetu;
    const name = trimText(raw);
    if (!name) return alert("Zadaj názov presetu.");
    if (hasForbidden(name)) return alert("Názov obsahuje zakázané znaky: . # $ [ ] /");

    try {
      await set(ref(db, `presets/${name}`), {});
      setNazovPresetu("");
      setNovyPresetOpen(false);
      setVybranyPreset(name);
    } catch (err) {
      console.error("Chyba pri ukladaní presetu:", err);
      alert("Preset sa nepodarilo uložiť.");
    }
  }

  async function vymazPreset(nazov) {
    if (!window.confirm(`Naozaj vymazať preset '${nazov}'?`)) return;
    try {
      await remove(ref(db, `presets/${nazov}`));
      if (vybranyPreset === nazov) setVybranyPreset("");
    } catch (err) {
      console.error("Chyba pri mazaní presetu:", err);
      alert("Preset sa nepodarilo vymazať.");
    }
  }

  async function pridatPolozku() {
    if (!vybranyPreset) return alert("Vyber preset.");
    const nazov = trimText(novaPolozka.nazov);
    const parsed = parseFloat(String(novaPolozka.cena).replace(",", "."));
    if (!nazov) return alert("Zadaj názov položky.");
    if (hasForbidden(nazov)) return alert("Názov položky obsahuje zakázané znaky: . # $ [ ] /");
    if (!isFinite(parsed) || parsed < 0) return alert("Zadaj platnú cenu.");

    try {
      await set(ref(db, `presets/${vybranyPreset}/${nazov}`), { cena: parsed });
      setNovaPolozka({ nazov: "", cena: "" });
    } catch (err) {
      console.error("Chyba pri pridávaní položky:", err);
      alert("Položku sa nepodarilo pridať.");
    }
  }

  async function vymazPolozku(nazov) {
    if (!vybranyPreset) return;
    if (!window.confirm(`Vymazať '${nazov}' z '${vybranyPreset}'?`)) return;
    try {
      await remove(ref(db, `presets/${vybranyPreset}/${nazov}`));
      if (editRadok?.nazov === nazov) setEditRadok(null);
    } catch (err) {
      console.error("Chyba pri mazaní položky:", err);
      alert("Položku sa nepodarilo vymazať.");
    }
  }

  function startEdit(nazov, cena) {
    setEditRadok({ nazov, cena: String(cena) });
  }
  async function ulozitEdit() {
    if (!editRadok) return;
    const parsed = parseFloat(String(editRadok.cena).replace(",", "."));
    if (!isFinite(parsed) || parsed < 0) return alert("Zadaj platnú cenu.");
    try {
      await set(ref(db, `presets/${vybranyPreset}/${editRadok.nazov}`), { cena: parsed });
      setEditRadok(null);
    } catch (err) {
      console.error("Chyba pri ukladaní zmeny:", err);
      alert("Zmenu sa nepodarilo uložiť.");
    }
  }

  function backToObsluha() {
    sessionStorage.setItem("obsluhaScrollY", String(window.scrollY));
    navigate("/kasa");
  }

  return (
    <div className="k-wrap">
      {/* TOP BAR */}
      <div className="k-top">
        <div className="k-row" style={{ justifyContent: "space-between" }}>
          <button className="k-btn" onClick={backToObsluha}>Späť do kasy</button>
          <h1 style={{ margin: 0 }}>Správa presetov</h1>
          <div style={{ width: 140 }} />
        </div>
      </div>

      {/* DVOJSTĹPCOVÝ */}
      <div className="k-2col">
        {/* Ľavý: vertikálny zoznam presetov */}
        <aside className="k-panel k-aside">
          <h2 className="k-title" style={{ marginTop: 0 }}>Presety</h2>

          <div className="k-vlist">
            {Object.keys(presety).sort((a, b) => a.localeCompare(b, "sk")).map((p) => (
              <div
                key={p}
                className={`k-preset-item ${vybranyPreset === p ? "active" : ""}`}
                onClick={() => setVybranyPreset(p)}
                title={p}
              >
                <div className="text">{p}</div>
                <div className="k-preset-actions">
                  <button
                    className="k-btn"
                    onClick={(e) => { e.stopPropagation(); vymazPreset(p); }}
                    title="Vymazať preset"
                    style={{ padding: "6px 8px" }}
                  >🗑️</button>
                </div>
              </div>
            ))}

            {/* Nový preset – riadok */}
            {!novyPresetOpen ? (
              <button className="k-preset-item ghost" onClick={() => setNovyPresetOpen(true)}>
                ➕ Nový preset
              </button>
            ) : (
              <div className="k-preset-item form" onClick={(e) => e.stopPropagation()}>
                <input
                  className="k-input"
                  placeholder="Názov presetu"
                  value={nazovPresetu}
                  onChange={(e) => setNazovPresetu(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && vytvorPreset()}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className="k-btn" onClick={vytvorPreset}>Uložiť</button>
                <button className="k-btn" onClick={() => { setNovyPresetOpen(false); setNazovPresetu(""); }}>
                  Zrušiť
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Pravý: detail vybraného presetu */}
        <section className="k-panel">
          {!vybranyPreset ? (
            <p className="k-help">Vyber preset alebo vytvor nový.</p>
          ) : (
            <>
              <div className="k-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 className="k-title" style={{ margin: 0 }}>
                  Preset: <code>{vybranyPreset}</code>
                </h2>
              </div>

              {/* Pridať položku */}
              <div className="k-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                <input
                  className="k-input"
                  placeholder="Názov položky"
                  value={novaPolozka.nazov}
                  onChange={(e) => setNovaPolozka((s) => ({ ...s, nazov: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && pridatPolozku()}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <input
                  className="k-input"
                  type="number"
                  placeholder="Cena"
                  value={novaPolozka.cena}
                  onChange={(e) => setNovaPolozka((s) => ({ ...s, cena: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && pridatPolozku()}
                  step="0.01"
                  min="0"
                  style={{ width: 140 }}
                />
                <button className="k-btn primary" onClick={pridatPolozku}>➕ Pridať</button>
              </div>

              {/* Zobrazenie položiek */}
              {polozky.length === 0 ? (
                <p className="k-help" style={{ marginTop: 12 }}>Tento preset je prázdny.</p>
              ) : (
                <>
                  {/* PC: tabuľka */}
                  <div className="hide-mobile" style={{ marginTop: 12 }}>
                    <div className="k-scroll-x">
                      <table className="k-table">
                        <thead>
                          <tr>
                            <th>Položka</th>
                            <th style={{ width: 160 }}>Cena</th>
                            <th style={{ width: 220 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {polozky.map(({ nazov, cena }) => {
                            const editing = editRadok?.nazov === nazov;
                            return (
                              <tr key={nazov}>
                                <td>{nazov}</td>
                                <td>
                                  {editing ? (
                                    <input
                                      className="k-input"
                                      type="number"
                                      value={editRadok.cena}
                                      onChange={(e) => setEditRadok((s) => ({ ...s, cena: e.target.value }))}
                                      onKeyDown={(e) => e.key === "Enter" && ulozitEdit()}
                                      step="0.01"
                                      min="0"
                                      style={{ width: 120 }}
                                      autoFocus
                                    />
                                  ) : (
                                    <>€{cena.toFixed(2)}</>
                                  )}
                                </td>
                                <td>
                                  <div className="k-row">
                                    {editing ? (
                                      <>
                                        <button className="k-btn" onClick={ulozitEdit}>Uložiť</button>
                                        <button className="k-btn" onClick={() => setEditRadok(null)}>✖️ Zrušiť</button>
                                      </>
                                    ) : (
                                      <>
                                        <button className="k-btn" onClick={() => startEdit(nazov, cena)}>✏️ Upraviť</button>
                                        <button className="k-btn" onClick={() => vymazPolozku(nazov)}>🗑️ Vymazať</button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobil: vertikálne karty */}
                  <div className="hide-desktop" style={{ marginTop: 12 }}>
                    <div className="k-vcards">
                      {polozky.map(({ nazov, cena }) => {
                        const editing = editRadok?.nazov === nazov;
                        return (
                          <div className="k-item-card" key={nazov}>
                            <div className="k-item-head">
                              <strong style={{ wordBreak: "break-word" }}>{nazov}</strong>
                              {!editing && <span className="k-price">€{cena.toFixed(2)}</span>}
                            </div>

                            {editing && (
                              <div className="k-row" style={{ marginTop: 8 }}>
                                <input
                                  className="k-input"
                                  type="number"
                                  value={editRadok.cena}
                                  onChange={(e) => setEditRadok((s) => ({ ...s, cena: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && ulozitEdit()}
                                  step="0.01"
                                  min="0"
                                  style={{ width: 140 }}
                                  autoFocus
                                />
                              </div>
                            )}

                            <div className="k-row" style={{ marginTop: 10 }}>
                              {editing ? (
                                <>
                                  <button className="k-btn" onClick={ulozitEdit}>Uložiť</button>
                                  <button className="k-btn" onClick={() => setEditRadok(null)}>Zrušiť</button>
                                </>
                              ) : (
                                <>
                                  <button className="k-btn" onClick={() => startEdit(nazov, cena)}>Upraviť</button>
                                  <button className="k-btn" onClick={() => vymazPolozku(nazov)}>Vymazať</button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}