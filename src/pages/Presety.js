import { useEffect, useMemo, useState, Fragment } from "react";
import { db } from "../firebase";
import { ref, set, onValue, remove, update } from "firebase/database";
import { useNavigate } from "react-router-dom";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./kiosk.css";
import { ITEM_COLORS } from "./Kasa";

// Tenký obal okolo useSortable – samotný obsah riadku/karty ostáva v Presety(),
// len sa mu cez render-prop dodajú {attributes, listeners} pre úchytku.
function SortableRow({ id, as: Tag = "tr", className, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <Tag ref={setNodeRef} style={style} className={className}>
      {children({ attributes, listeners })}
    </Tag>
  );
}

function DragHandle({ attributes, listeners }) {
  return (
    <button
      type="button"
      className="k-btn"
      style={{ padding: "2px 10px", cursor: "grab", touchAction: "none" }}
      {...attributes}
      {...listeners}
      title="Podrž a presuň"
    >
      ⠿
    </button>
  );
}

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
  const [pickerOpenFor, setPickerOpenFor] = useState(null);

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
        farba: (v?.farba != null) ? Number(v.farba) : null,
        poradie: (v?.poradie != null) ? Number(v.poradie) : null,
        prilohy: Object.entries(v?.prilohy || {})
          .map(([pn, pv]) => ({
            nazov: pn,
            cena: Number(pv?.cena ?? 0),
            poradie: (pv?.poradie != null) ? Number(pv.poradie) : null,
          }))
          .sort((a, b) => {
            const pa = a.poradie ?? Infinity;
            const pb = b.poradie ?? Infinity;
            if (pa !== pb) return pa - pb;
            return a.nazov.localeCompare(b.nazov, "sk");
          }),
      }))
      .sort((a, b) => {
        const pa = a.poradie ?? Infinity;
        const pb = b.poradie ?? Infinity;
        if (pa !== pb) return pa - pb;
        return a.nazov.localeCompare(b.nazov, "sk");
      });
  }, [presety, vybranyPreset]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Zapíše poradie = index pre každú položku daného zoznamu, na dodanú Firebase cestu
  // (buď presets/{preset} pre položky, alebo presets/{preset}/{polozka}/prilohy pre prílohy).
  async function ulozitPoradie(noveNazvy, cesta) {
    const updates = {};
    noveNazvy.forEach((nazov, i) => {
      updates[`${cesta}/${nazov}/poradie`] = i;
    });
    try {
      await update(ref(db), updates);
    } catch (err) {
      alert("Poradie sa nepodarilo uložiť.");
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = polozky.findIndex((p) => p.nazov === active.id);
    const newIndex = polozky.findIndex((p) => p.nazov === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    ulozitPoradie(arrayMove(polozky.map((p) => p.nazov), oldIndex, newIndex), `presets/${vybranyPreset}`);
  }

  function handleDragEndPrilohy(itemNazov, prilohyList) {
    return (event) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = prilohyList.findIndex((p) => p.nazov === active.id);
      const newIndex = prilohyList.findIndex((p) => p.nazov === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      ulozitPoradie(
        arrayMove(prilohyList.map((p) => p.nazov), oldIndex, newIndex),
        `presets/${vybranyPreset}/${itemNazov}/prilohy`
      );
    };
  }

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
      if (editRadok?.povodnyNazov === nazov) setEditRadok(null);
      if (expandedItem === nazov) setExpandedItem(null);
    } catch (err) {
      alert("Položku sa nepodarilo vymazať.");
    }
  }

  function startEdit(nazov, cena) {
    setEditRadok({ povodnyNazov: nazov, nazov, cena: String(cena) });
  }

  async function ulozitEdit() {
    if (!editRadok) return;
    const povodnyNazov = editRadok.povodnyNazov;
    const novyNazov = trimText(editRadok.nazov);
    const parsed = parseFloat(String(editRadok.cena).replace(",", "."));
    if (!novyNazov) return alert("Zadaj názov položky.");
    if (hasForbidden(novyNazov)) return alert("Názov položky obsahuje zakázané znaky: . # $ [ ] /");
    if (!isFinite(parsed) || parsed < 0) return alert("Zadaj platnú cenu.");
    try {
      if (novyNazov !== povodnyNazov) {
        if (presety[vybranyPreset]?.[novyNazov]) {
          return alert(`Položka '${novyNazov}' už v tomto presete existuje.`);
        }
        const existujuce = presety[vybranyPreset]?.[povodnyNazov] || {};
        const updates = {};
        updates[`presets/${vybranyPreset}/${novyNazov}`] = { ...existujuce, cena: parsed };
        updates[`presets/${vybranyPreset}/${povodnyNazov}`] = null;
        await update(ref(db), updates);
        if (expandedItem === povodnyNazov) setExpandedItem(novyNazov);
      } else {
        await set(ref(db, `presets/${vybranyPreset}/${povodnyNazov}/cena`), parsed);
      }
      setEditRadok(null);
    } catch (err) {
      alert("Zmenu sa nepodarilo uložiť.");
    }
  }

  async function ulozitFarbu(itemNazov, idx) {
    try {
      if (idx == null) {
        await remove(ref(db, `presets/${vybranyPreset}/${itemNazov}/farba`));
      } else {
        await set(ref(db, `presets/${vybranyPreset}/${itemNazov}/farba`), idx);
      }
    } catch (err) {
      alert("Farbu sa nepodarilo uložiť.");
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

  function ColorPickerToggle({ nazov, current }) {
    const isOpen = pickerOpenFor === nazov;
    const col = current != null ? ITEM_COLORS[current] : null;
    return (
      <div style={{ position: "relative", display: "inline-block" }}>
        <div
          onClick={() => setPickerOpenFor(isOpen ? null : nazov)}
          title="Vybrať farbu"
          style={{
            width: 30, height: 30, borderRadius: 7, cursor: "pointer",
            background: col ? col.bg : "#f3f4f6",
            border: col ? `2px solid ${col.border}` : "2px dashed #d1d5db",
            boxSizing: "border-box",
          }}
        />
        {isOpen && (
          <div style={{
            position: "absolute", top: 36, left: 0, zIndex: 50,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
            padding: 8, boxShadow: "0 4px 16px rgba(0,0,0,.14)",
            display: "flex", flexWrap: "wrap", gap: 5, width: 232,
          }}>
            <div
              onClick={() => { ulozitFarbu(nazov, null); setPickerOpenFor(null); }}
              title="Bez farby"
              style={{
                width: 24, height: 24, borderRadius: 5, cursor: "pointer",
                background: "#f3f4f6", border: "2px dashed #d1d5db",
                boxSizing: "border-box",
              }}
            />
            {ITEM_COLORS.map((c, i) => (
              <div
                key={i}
                onClick={() => { ulozitFarbu(nazov, i); setPickerOpenFor(null); }}
                title={`Farba ${i + 1}`}
                style={{
                  width: 24, height: 24, borderRadius: 5, cursor: "pointer",
                  background: c.bg,
                  border: current === i ? `3px solid ${c.btn}` : `1px solid ${c.border}`,
                  boxSizing: "border-box",
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderPrilohyPanel(item) {
    return (
      <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "3px solid var(--k-primary)" }}>
        {item.prilohy.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndPrilohy(item.nazov, item.prilohy)}>
              <SortableContext items={item.prilohy.map((p) => p.nazov)} strategy={verticalListSortingStrategy}>
                {item.prilohy.map((p) => (
                  <SortableRow id={p.nazov} as="div" key={p.nazov}>
                    {({ attributes, listeners }) => (
                      <div className="k-row" style={{ justifyContent: "space-between", padding: "3px 0" }}>
                        <div className="k-row" style={{ gap: 6 }}>
                          <DragHandle attributes={attributes} listeners={listeners} />
                          <span>{p.nazov}</span>
                        </div>
                        <div className="k-row" style={{ gap: 8 }}>
                          <span className="k-help">€{p.cena.toFixed(2)}</span>
                          <button className="k-btn" style={{ padding: "3px 8px" }} onClick={() => vymazPrilohu(item.nazov, p.nazov)}>🗑️</button>
                        </div>
                      </div>
                    )}
                  </SortableRow>
                ))}
              </SortableContext>
            </DndContext>
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
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={polozky.map((p) => p.nazov)} strategy={verticalListSortingStrategy}>
                      <table className="k-table">
                        <thead>
                          <tr>
                            <th style={{ width: 50 }}></th>
                            <th>Položka</th>
                            <th style={{ width: 160 }}>Cena</th>
                            <th style={{ width: 180 }}>Farba</th>
                            <th style={{ width: 280 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {polozky.map((item) => {
                            const { nazov, cena, prilohy } = item;
                            const editing = editRadok?.povodnyNazov === nazov;
                            const expanded = expandedItem === nazov;
                            return (
                              <Fragment key={nazov}>
                                <SortableRow id={nazov}>
                                  {({ attributes, listeners }) => (
                                    <>
                                  <td>
                                    <DragHandle attributes={attributes} listeners={listeners} />
                                  </td>
                                  <td>
                                    {editing ? (
                                      <input
                                        className="k-input"
                                        value={editRadok.nazov}
                                        onChange={(e) => setEditRadok((s) => ({ ...s, nazov: e.target.value }))}
                                        onKeyDown={(e) => e.key === "Enter" && ulozitEdit()}
                                        style={{ width: 160 }}
                                        autoFocus
                                      />
                                    ) : (
                                      nazov
                                    )}
                                  </td>
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
                                      />
                                    ) : (
                                      <>€{cena.toFixed(2)}</>
                                    )}
                                  </td>
                                  <td>
                                    <ColorPickerToggle nazov={nazov} current={item.farba} />
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
                                    </>
                                  )}
                                </SortableRow>
                                {expanded && (
                                  <tr>
                                    <td colSpan={4} style={{ background: "#fafafa", padding: "8px 16px" }}>
                                      {renderPrilohyPanel(item)}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                      </SortableContext>
                      </DndContext>
                    </div>
                  </div>

                  {/* Mobil */}
                  <div className="hide-desktop" style={{ marginTop: 12 }}>
                    <div className="k-vcards">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={polozky.map((p) => p.nazov)} strategy={verticalListSortingStrategy}>
                      {polozky.map((item) => {
                        const { nazov, cena, prilohy } = item;
                        const editing = editRadok?.povodnyNazov === nazov;
                        const expanded = expandedItem === nazov;
                        return (
                          <SortableRow id={nazov} as="div" className="k-item-card" key={nazov}>
                            {({ attributes, listeners }) => (
                              <>
                            <div className="k-item-head">
                              <DragHandle attributes={attributes} listeners={listeners} />
                              {!editing && <strong style={{ wordBreak: "break-word" }}>{nazov}</strong>}
                              {!editing && <span className="k-price">€{cena.toFixed(2)}</span>}
                            </div>

                            {editing && (
                              <div className="k-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                                <input
                                  className="k-input"
                                  value={editRadok.nazov}
                                  onChange={(e) => setEditRadok((s) => ({ ...s, nazov: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && ulozitEdit()}
                                  style={{ flex: 1, minWidth: 140 }}
                                  autoFocus
                                />
                                <input
                                  className="k-input"
                                  type="number"
                                  value={editRadok.cena}
                                  onChange={(e) => setEditRadok((s) => ({ ...s, cena: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && ulozitEdit()}
                                  step="0.01"
                                  min="0"
                                  style={{ width: 140 }}
                                />
                              </div>
                            )}

                            <div style={{ marginTop: 8 }}>
                              <ColorPickerToggle nazov={nazov} current={item.farba} />
                            </div>
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
                              </>
                            )}
                          </SortableRow>
                        );
                      })}
                      </SortableContext>
                      </DndContext>
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
