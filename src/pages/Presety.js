import { useEffect, useMemo, useState, Fragment } from "react";
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
  const [expandedItem, setExpandedItem] = useState(null);
  const [novaPriloha, setNovaPriloha] = useState({ nazov: "", cena: "" });

  useEffect(() => {
    const off = onValue(ref(db, "presets"), (snap) => setPresety(snap.val() || {}));
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
      .map(([nazov, v]) => ({
        nazov,
        cena: Number(v?.cena ?? 0),
        prilohy: Object.entries(v?.prilohy || {})
          .map(([pn, pv]) => ({ nazov: pn, cena: Number(pv?.cena ?? 0) }))
          .sort((a, b) => a.nazov.localeCompare(b.nazov, "sk")),
      }))
      .sort((a, b) => a.nazov.localeCompare(b.nazov, "sk"));
  }, [presety, vybranyPreset]);

  const hasForbidden = (s) => /[.#$/[\]]/.test(s);
  const trimText = (s) => s.trim();

  async function vytvorPreset() {
    const name = trimText(nazovPresetu);
    if (!name) return alert("Zadaj názov presetu.");
    if (hasForbidden(name)) return alert("Názov obsahuje zakázané znaky: . # $ [ ] /");
    try {
      await set(ref(db, `presets/${name}`), {});
      setNazovPresetu("");
      setNovyPresetOpen(false);
      setVybranyPreset(name);
    } catch (err) {
      alert("Preset sa nepodarilo uložiť.");
    }
  }

  async function vymazPreset(nazov) {
    if (!window.confirm(`Naozaj vymazať preset '${nazov}'?`)) return;
    try {
      await remove(ref(db, `presets/${nazov}`));
      if (vybranyPreset === nazov) setVybranyPreset("");
    } catch (err) {
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
      await set(ref(db, `presets/${vybranyPreset}/${nazov}/cena`), parsed);
      setNovaPolozka({ nazov: "", cena: "" });
    } catch (err) {
      alert("Položku sa nepodarilo pridať.");
    }
  }

  async function vymazPolozku(nazov) {
    if (!vybranyPreset) return;
    if (!window.confirm(`Vymazať '${nazov}' z '${vybranyPreset}'?`)) return;
    try {
      await remove(ref(db, `presets/${vybranyPreset}/${nazov}`));
      if (editRadok?.nazov === nazov) setEditRadok(null);
      if (expandedItem === nazov) setExpandedItem(null);
    } catch (err) {
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
      await set(ref(db, `presets/${vybranyPreset}/${editRadok.nazov}/cena`), parsed);
      setEditRadok(null);
    } catch (err) {
      alert("Zmenu sa nepodarilo uložiť.");
    }
  }

  async function pridatPrilohu(itemNazov) {
    const nazov = trimText(novaPriloha.nazov);
    const parsed = parseFloat(String(novaPriloha.cena).replace(",", "."));
    if (!nazov) return alert("Zadaj názov prílohy.");
    if (hasForbidden(nazov)) return alert("Názov prílohy obsahuje zakázané znaky: . # $ [ ] /");
    if (!isFinite(parsed) || parsed < 0) return alert("Zadaj platnú cenu prílohy.");
    try {
      await set(ref(db, `presets/${vybranyPreset}/${itemNazov}/prilohy/${nazov}`), { cena: parsed });
      setNovaPriloha({ nazov: "", cena: "" });
    } catch (err) {
      alert("Prílohu sa nepodarilo pridať.");
    }
  }

  async function vymazPrilohu(itemNazov, prilohaName) {
    if (!window.confirm(`Vymazať prílohu '${prilohaName}'?`)) return;
    try {
      await remove(ref(db, `presets/${vybranyPreset}/${itemNazov}/prilohy/${prilohaName}`));
    } catch (err) {
      alert("Prílohu sa nepodarilo vymazať.");
    }
  }

  function toggleExpand(nazov) {
    setExpandedItem((prev) => (prev === nazov ? null : nazov));
    setNovaPriloha({ nazov: "", cena: "" });
  }

  function renderPrilohyPanel(item) {
    return (
      <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "3px solid var(--k-primary)" }}>
        {item.prilohy.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {item.prilohy.map((p) => (
              <div key={p.nazov} className="k-row" style={{ justifyContent: "space-between", padding: "3px 0" }}>
                <span>↳ {p.nazov}</span>
                <div className="k-row" style={{ gap: 8 }}>
                  <span className="k-help">€{p.cena.toFixed(2)}</span>
                  <button className="k-btn" style={{ padding: "3px 8px" }} onClick={() => vymazPrilohu(item.nazov, p.nazov)}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="k-row" style={{ flexWrap: "wrap", gap: 6 }}>
          <input
            className="k-input"
            placeholder="Názov prílohy"
            value={novaPriloha.nazov}
            onChange={(e) => setNovaPriloha((s) => ({ ...s, nazov: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && pridatPrilohu(item.nazov)}
            style={{ flex: 1, minWidth: 140 }}
          />
          <input
            className="k-input"
            type="number"
            placeholder="Cena"
            value={novaPriloha.cena}
            onChange={(e) => setNovaPriloha((s) => ({ ...s, cena: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && pridatPrilohu(item.nazov)}
            step="0.01"
            min="0"
            style={{ width: 100 }}
          />
          <button className="k-btn primary" onClick={() => pridatPrilohu(item.nazov)}>+ Príloha</button>
        </div>
      </div>
    );
  }

  function backToObsluha() {
    sessionStorage.setItem("obsluhaScrollY", String(window.scrollY));
    navigate("/kasa");
  }

  return (
    <div className="k-wrap">
      <div className="k-top">
        <div className="k-row" style={{ justifyContent: "space-between" }}>
          <button className="k-btn" onClick={backToObsluha}>Späť do kasy</button>
          <h1 style={{ margin: 0 }}>Správa presetov</h1>
          <div style={{ width: 140 }} />
        </div>
      </div>

      <div className="k-2col">
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
                <button className="k-btn" onClick={() => { setNovyPresetOpen(false); setNazovPresetu(""); }}>Zrušiť</button>
              </div>
            )}
          </div>
        </aside>

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
                            <th style={{ width: 280 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {polozky.map((item) => {
                            const { nazov, cena, prilohy } = item;
                            const editing = editRadok?.nazov === nazov;
                            const expanded = expandedItem === nazov;
                            return (
                              <Fragment key={nazov}>
                                <tr>
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
                                          <button
                                            className={`k-btn${expanded ? " accent" : ""}`}
                                            onClick={() => toggleExpand(nazov)}
                                          >
                                            Prílohy{prilohy.length > 0 ? ` (${prilohy.length})` : ""}
                                          </button>
                                          <button className="k-btn" onClick={() => vymazPolozku(nazov)}>🗑️ Vymazať</button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {expanded && (
                                  <tr>
                                    <td colSpan={3} style={{ background: "#fafafa", padding: "8px 16px" }}>
                                      {renderPrilohyPanel(item)}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobil */}
                  <div className="hide-desktop" style={{ marginTop: 12 }}>
                    <div className="k-vcards">
                      {polozky.map((item) => {
                        const { nazov, cena, prilohy } = item;
                        const editing = editRadok?.nazov === nazov;
                        const expanded = expandedItem === nazov;
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

                            <div className="k-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                              {editing ? (
                                <>
                                  <button className="k-btn" onClick={ulozitEdit}>Uložiť</button>
                                  <button className="k-btn" onClick={() => setEditRadok(null)}>Zrušiť</button>
                                </>
                              ) : (
                                <>
                                  <button className="k-btn" onClick={() => startEdit(nazov, cena)}>Upraviť</button>
                                  <button
                                    className={`k-btn${expanded ? " accent" : ""}`}
                                    onClick={() => toggleExpand(nazov)}
                                  >
                                    Prílohy{prilohy.length > 0 ? ` (${prilohy.length})` : ""}
                                  </button>
                                  <button className="k-btn" onClick={() => vymazPolozku(nazov)}>Vymazať</button>
                                </>
                              )}
                            </div>

                            {expanded && renderPrilohyPanel(item)}
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
