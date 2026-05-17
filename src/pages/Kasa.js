import { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import {
  ref,
  set,
  push,
  onValue,
  runTransaction,
  onDisconnect,
} from "firebase/database";
import { useNavigate } from "react-router-dom";
import InfoModal from "../components/InfoModal";

import "./kiosk.css";
import RoleHeader from "./RoleHeader";
import { useSession } from "../SessionProvider";

const VIP_VYSIELACE = ["01", "02", "03", "04"];

export default function Kasa() {
  const navigate = useNavigate();
  const { sessionCode: session } = useSession();

  const [preset, setPreset] = useState("");
  const [vsetkyPresety, setVsetkyPresety] = useState([]);
  const [menu, setMenu] = useState([]);
  const [zablokovaneVysielace, setZablokovaneVysielace] = useState({});
  const [zvolenyVysielac, setZvolenyVysielac] = useState(null);
  // Each entry: { id: string, nazov: string, prilohy: { [prilohaName]: count } }
  const [cartItems, setCartItems] = useState([]);
  const [showInfo, setShowInfo] = useState(false);
  const [logZaznamy, setLogZaznamy] = useState([]);
  const [prevzateMap, setPrevzateMap] = useState({});
  const [now, setNow] = useState(Date.now());
  const [zaplatene, setZaplatene] = useState(0);

  const mamAktivnyLock = useRef(false);
  const skipAutoUnlockOnce = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const off = onValue(ref(db, "presets"), (snap) => {
      setVsetkyPresety(Object.keys(snap.val() || {}));
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}`), (snap) => {
      const data = snap.val();
      if (data?.preset) setPreset(data.preset);
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}/log`), (s) => {
      const val = s.val() || {};
      const arr = Object.entries(val)
        .map(([id, rec]) => ({ id, ...rec }))
        .sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0));
      setLogZaznamy(arr);
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}/prevzate`), (s) => {
      setPrevzateMap(s.val() || {});
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    if (!preset) return;
    const off = onValue(ref(db, `presets/${preset}`), (snap) => {
      const data = snap.val() || {};
      setMenu(Object.entries(data).map(([nazov, v]) => ({
        nazov,
        cena: Number((v && v.cena) ?? 0),
        prilohy: Object.entries(v?.prilohy || {})
          .map(([pn, pv]) => ({ nazov: pn, cena: Number(pv?.cena ?? 0) }))
          .sort((a, b) => a.nazov.localeCompare(b.nazov, "sk")),
      })));
    });
    return () => off();
  }, [preset]);

  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}/vysielace`), (snap) => {
      setZablokovaneVysielace(snap.val() || {});
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    const ulozenyPreset = sessionStorage.getItem("preset");
    const ulozenyVysielac = sessionStorage.getItem("zvolenyVysielac");
    if (ulozenyPreset) setPreset(ulozenyPreset);
    if (ulozenyVysielac) setZvolenyVysielac(ulozenyVysielac);
    const y = Number(sessionStorage.getItem("obsluhaScrollY") || "0");
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
  }, []);

  useEffect(() => {
    if (preset) sessionStorage.setItem("preset", preset);
  }, [preset]);

  useEffect(() => {
    if (zvolenyVysielac !== null) {
      sessionStorage.setItem("zvolenyVysielac", String(zvolenyVysielac));
    } else {
      sessionStorage.removeItem("zvolenyVysielac");
    }
  }, [zvolenyVysielac]);

  useEffect(() => {
    const unlockIfNeeded = async () => {
      if (!session || zvolenyVysielac == null) return;
      if (skipAutoUnlockOnce.current) { skipAutoUnlockOnce.current = false; return; }
      if (!mamAktivnyLock.current) return;
      try {
        await set(ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`), null);
      } catch (e) {
        console.error("Chyba pri auto-unlocku:", e);
      } finally {
        mamAktivnyLock.current = false;
      }
    };
    return () => { unlockIfNeeded(); };
  }, [session, zvolenyVysielac]);

  function orderColor(id) {
    let h = 0;
    const s = String(id || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
    return `hsl(${Math.abs(h) % 360}, 50%, 91%)`;
  }

  function timeAgo(ts) {
    const diff = Math.max(1, Math.floor((now - (ts || now)) / 1000));
    if (diff < 60) return `${diff}s`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  }

  async function oznacitPrevzate(id, vys = null) {
    if (!session) return;
    await set(ref(db, `sessions/${session}/prevzate/${id}`), true);
    if (vys != null) {
      await set(ref(db, `sessions/${session}/vysielace/${vys}`), null);
    }
  }

  async function zrusitObjednavku() {
    if (cartItems.length > 0) {
      const ok = window.confirm("Zrušiť rozpracovanú objednávku?");
      if (!ok) return;
    }
    setCartItems([]);
    setZvolenyVysielac(null);
    setZaplatene(0);
  }

  function pridajPolozku(nazov) {
    setCartItems((prev) => [
      ...prev,
      { id: `${nazov}-${Date.now()}-${Math.random()}`, nazov, prilohy: {} },
    ]);
  }

  function odobratPolozku(nazov) {
    setCartItems((prev) => {
      const lastIdx = [...prev].map((x, i) => [x, i]).reverse().find(([x]) => x.nazov === nazov)?.[1];
      if (lastIdx == null) return prev;
      return [...prev.slice(0, lastIdx), ...prev.slice(lastIdx + 1)];
    });
  }

  function pridajPrilohu(itemId, prilohaName) {
    setCartItems((prev) =>
      prev.map((item) =>
        item.id !== itemId
          ? item
          : { ...item, prilohy: { ...item.prilohy, [prilohaName]: (item.prilohy[prilohaName] || 0) + 1 } }
      )
    );
  }

  function odobratPrilohu(itemId, prilohaName) {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const newPrilohy = { ...item.prilohy };
        if ((newPrilohy[prilohaName] || 0) > 1) newPrilohy[prilohaName]--;
        else delete newPrilohy[prilohaName];
        return { ...item, prilohy: newPrilohy };
      })
    );
  }

  function spocitajCenu() {
    let sum = 0;
    cartItems.forEach((item) => {
      const pol = menu.find((m) => m.nazov === item.nazov);
      sum += pol?.cena || 0;
      Object.entries(item.prilohy).forEach(([prilohaName, count]) => {
        const pr = pol?.prilohy?.find((p) => p.nazov === prilohaName);
        sum += (pr?.cena || 0) * count;
      });
    });
    return Math.round(sum * 100) / 100;
  }

  async function potvrditObjednavku() {
    try {
      if (!session || !zvolenyVysielac || cartItems.length === 0) return;

      const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
      const res = await runTransaction(
        lockRef,
        (current) => {
          if (current === true || current === "locked") return;
          if (current === "ready" || current === "pripraveny") return;
          return true;
        },
        { applyLocally: false }
      );

      if (!res.committed) {
        const st = res.snapshot?.val();
        alert(st === "ready" ? "Tento vysielač má pripravenú objednávku." : "Tento vysielač je momentálne zamknutý.");
        return;
      }

      mamAktivnyLock.current = true;
      try { await onDisconnect(lockRef).remove(); } catch {}

      // Aggregate polozky: { [nazov]: count }
      const polozky = {};
      cartItems.forEach((item) => {
        polozky[item.nazov] = (polozky[item.nazov] || 0) + 1;
      });

      // Prilohy indexed by "nazov||instanceIdx" for per-unit distinction
      const prilohy = {};
      const nameCount = {};
      cartItems.forEach((item) => {
        const idx = nameCount[item.nazov] || 0;
        nameCount[item.nazov] = idx + 1;
        if (Object.keys(item.prilohy).length > 0) {
          prilohy[`${item.nazov}||${idx}`] = item.prilohy;
        }
      });

      const isExpress = VIP_VYSIELACE.includes(String(zvolenyVysielac));
      const now = Date.now();

      // Atomicky získaj ďalšie číslo objednávky (1–100, cyklicky)
      const counterRef = ref(db, `sessions/${session}/orderCounter`);
      const counterRes = await runTransaction(counterRef, (current) => {
        if (current === null || current >= 100) return 1;
        return current + 1;
      });
      const orderNumber = counterRes.snapshot.val();

      if (isExpress) {
        // Expresná objednávka – preskočí kuchyňu, ide rovno ako ready
        const newLog = push(ref(db, `sessions/${session}/log`));
        await set(newLog, {
          vysielac: zvolenyVysielac,
          orderNumber,
          polozky,
          ...(Object.keys(prilohy).length > 0 ? { prilohy } : {}),
          suma: spocitajCenu(),
          completedAt: now,
          createdAt: now,
        });
        try { await onDisconnect(lockRef).cancel(); } catch {}
        await set(lockRef, "ready");
        mamAktivnyLock.current = false;
      } else {
        const newRef = push(ref(db, `sessions/${session}/objednavky`));
        await set(newRef, {
          vysielac: zvolenyVysielac,
          orderNumber,
          polozky,
          ...(Object.keys(prilohy).length > 0 ? { prilohy } : {}),
          suma: spocitajCenu(),
          status: "waiting",
          timestamp: now,
        });
        try { await onDisconnect(lockRef).cancel(); } catch {}
        await set(lockRef, true);
        mamAktivnyLock.current = true;
      }

      skipAutoUnlockOnce.current = true;
      setCartItems([]);
      setZvolenyVysielac(null);
      setZaplatene(0);
    } catch (err) {
      console.error("Chyba pri potvrdení objednávky:", err);
    }
  }

  async function zmenitPreset(novyPreset) {
    try {
      if (!session) return;
      await set(ref(db, `sessions/${session}/preset`), novyPreset);
      setPreset(novyPreset);
      sessionStorage.setItem("preset", novyPreset || "");
    } catch (err) {
      console.error("Chyba pri zmene presetu:", err);
    }
  }

  function goToPresety() {
    sessionStorage.setItem("obsluhaScrollY", String(window.scrollY));
    navigate("/presety");
  }

  const nevydane = logZaznamy.filter((z) => !prevzateMap[z.id]);

  if (!session) return null;

  return (
    <>
      <RoleHeader />
      <div className="k-wrap">
        <div className="k-top">
          <div className="k-row" style={{ justifyContent: "space-between" }}>
            <div className="k-row">
              <button className="btn" onClick={() => setShowInfo(true)}>Info</button>
              <button className="k-btn" onClick={goToPresety}>Presety</button>
              {vsetkyPresety.length ? (
                <select
                  className="k-select"
                  value={preset}
                  onChange={(e) => zmenitPreset(e.target.value)}
                >
                  <option value="">— Vyberte preset —</option>
                  {vsetkyPresety.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              ) : (
                <span className="k-help">Žiadne presety</span>
              )}
              <h1 style={{ margin: 0 }}>Kasa</h1>
            </div>
          </div>
        </div>
        {showInfo && <InfoModal session={session} onClose={() => setShowInfo(false)} />}

        <div className="k-grid">
          <div className="k-col">
            <div className="k-panel">
              <div className="k-menu">
                {menu.length === 0 && <i>Menu je prázdne.</i>}
                {menu.map((p) => {
                  const count = cartItems.filter((x) => x.nazov === p.nazov).length;
                  return (
                    <div className={`k-card${count > 0 ? " in-cart" : ""}`} key={p.nazov}>
                      <div className="name">{p.nazov}</div>
                      <div className="price">€{p.cena.toFixed(2)}</div>
                      <div className="actions">
                        {count === 0 ? (
                          <button className="k-card-add" onClick={() => pridajPolozku(p.nazov)}>Pridať</button>
                        ) : (
                          <div className="k-qty">
                            <button onClick={() => odobratPolozku(p.nazov)} aria-label="Odobrať">–</button>
                            <strong>{count}</strong>
                            <button onClick={() => pridajPolozku(p.nazov)} aria-label="Pridať">+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignSelf: "start" }}>
            <aside className="k-panel k-cart" style={{ position: "static", width: "100%" }}>
              <h3 style={{ marginTop: 0 }}>Moja objednávka</h3>

              <div style={{ marginBottom: 12 }}>
                <div className="k-help" style={{ marginBottom: 4 }}>Prednostné:</div>
                <div className="k-row" style={{ flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {VIP_VYSIELACE.map((v) => {
                    const st = zablokovaneVysielace[v];
                    const locked = st === true || st === "locked";
                    const isSelected = String(zvolenyVysielac) === v;
                    return (
                      <button
                        key={v}
                        className={`k-btn${isSelected ? " accent" : ""}`}
                        disabled={locked && !isSelected}
                        onClick={() => setZvolenyVysielac(isSelected ? null : v)}
                        title={locked ? "Zamknutý" : "Prednostný vysielač"}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
                <div className="k-row" style={{ alignItems: "center", gap: 8 }}>
                  <label style={{ whiteSpace: "nowrap" }}>Vysielač:</label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    placeholder="1–24"
                    value={zvolenyVysielac !== null && !VIP_VYSIELACE.includes(String(zvolenyVysielac)) ? zvolenyVysielac : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setZvolenyVysielac(val ? Number(val) : null);
                    }}
                    style={{ width: 70, padding: "6px 8px", borderRadius: 8, border: "1px solid #ccc", fontSize: 15 }}
                  />
                  {zvolenyVysielac !== null && (() => {
                    const st = zablokovaneVysielace[zvolenyVysielac];
                    if (st === true || st === "locked") return <span style={{ color: "#dc2626" }}>Zamknutý</span>;
                    if (st === "ready") return <span style={{ color: "#d97706" }}>Pripravený</span>;
                    if (st === "prevzate") return <span style={{ color: "#16a34a" }}>Prevzatý</span>;
                    if (zvolenyVysielac) return <span style={{ color: "#16a34a" }}>Voľný</span>;
                    return null;
                  })()}
                </div>
              </div>

              {cartItems.length === 0 ? (
                <p className="k-help">Žiadne položky. Pridajte z ponuky.</p>
              ) : (
                <>
                  <div>
                    {cartItems.map((item, globalIdx) => {
                      const pol = menu.find((m) => m.nazov === item.nazov);
                      const cena = pol?.cena || 0;
                      const dostupnePrilohy = pol?.prilohy || [];
                      const sameNameBefore = cartItems.slice(0, globalIdx).filter((x) => x.nazov === item.nazov).length;
                      const totalOfName = cartItems.filter((x) => x.nazov === item.nazov).length;
                      const label = totalOfName > 1 ? `${item.nazov} #${sameNameBefore + 1}` : item.nazov;
                      return (
                        <div key={item.id} style={{ marginBottom: 8, borderBottom: "1px solid #f0f0f0", paddingBottom: 6 }}>
                          <div className="row">
                            <div style={{ maxWidth: 220 }}>
                              <strong>{label}</strong>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span>€{cena.toFixed(2)}</span>
                              <button
                                className="k-btn"
                                style={{ padding: "2px 8px", minWidth: 28 }}
                                onClick={() => odobratPolozku(item.nazov)}
                                aria-label="Odobrať"
                              >
                                –
                              </button>
                            </div>
                          </div>
                          {dostupnePrilohy.length > 0 && (
                            <div style={{ paddingLeft: 12, marginTop: 2 }}>
                              {dostupnePrilohy.map((p) => {
                                const cnt = item.prilohy[p.nazov] || 0;
                                return (
                                  <div key={p.nazov} className="k-row" style={{ justifyContent: "space-between", padding: "2px 0" }}>
                                    <span style={{ fontSize: 14, fontWeight: 600 }}>↳ {p.nazov} <span style={{ color: "#6b7280", fontWeight: 400 }}>€{p.cena.toFixed(2)}</span></span>
                                    <div className="k-row" style={{ gap: 4 }}>
                                      {cnt > 0 && (
                                        <>
                                          <button className="k-btn" style={{ padding: "2px 8px", minWidth: 28 }} onClick={() => odobratPrilohu(item.id, p.nazov)}>–</button>
                                          <span style={{ minWidth: 16, textAlign: "center" }}>{cnt}</span>
                                        </>
                                      )}
                                      <button className="k-btn" style={{ padding: "2px 8px", minWidth: 28 }} onClick={() => pridajPrilohu(item.id, p.nazov)}>+</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="row" style={{ borderBottom: "none", paddingTop: 10 }}>
                    <div className="sum">Spolu</div>
                    <div className="sum">€{spocitajCenu().toFixed(2)}</div>
                  </div>
                </>
              )}

              <div className="k-row" style={{ marginTop: 12 }}>
                <button className="k-btn" onClick={zrusitObjednavku}>Zrušiť</button>
                <button
                  className="k-btn accent"
                  disabled={!zvolenyVysielac || cartItems.length === 0}
                  onClick={potvrditObjednavku}
                >
                  Potvrdiť objednávku
                </button>
              </div>
              <div className="k-help">Po potvrdení sa vysielač uzamkne.</div>
            </aside>

            {/* KALKULAČKA */}
            {(() => {
              const BANKOVKY = [100, 50, 20, 10, 5];
              const MINCE = [2, 1, 0.50, 0.20, 0.10, 0.05];
              const suma = spocitajCenu();
              const vydaj = Math.round((zaplatene - suma) * 100) / 100;
              const pridaj = (h) => setZaplatene((p) => Math.round((p + h) * 100) / 100);
              return (
                <div className="k-panel">
                  <div className="k-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                    <strong>Kalkulačka</strong>
                    <button className="k-btn" onClick={() => setZaplatene(0)}>Reset</button>
                  </div>

                  <div className="k-row" style={{ flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                    {BANKOVKY.map((h) => (
                      <button key={h} className="k-btn" onClick={() => pridaj(h)}>{h}€</button>
                    ))}
                  </div>
                  <div className="k-row" style={{ flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                    {MINCE.map((h) => (
                      <button key={h} className="k-btn" onClick={() => pridaj(h)}>
                        {h >= 1 ? `${h}€` : `${Math.round(h * 100)}c`}
                      </button>
                    ))}
                  </div>

                  <div className="k-row" style={{ justifyContent: "space-between" }}>
                    <div className="k-help">
                      Zaplatené: <strong>€{zaplatene.toFixed(2)}</strong>
                    </div>
                    {zaplatene > 0 && (
                      <div style={{ fontWeight: 700, color: vydaj >= 0 ? "#16a34a" : "#dc2626" }}>
                        {vydaj >= 0 ? `Vydať: €${vydaj.toFixed(2)}` : `Chýba: €${Math.abs(vydaj).toFixed(2)}`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* PRIPRAVENÉ OBJEDNÁVKY — desktop tabuľka */}
            {nevydane.length > 0 && (
              <div className="k-panel hide-mobile">
                <div className="k-table-wrap">
                  <table className="k-table">
                    <thead>
                      <tr>
                        <th>Čas</th>
                        <th>Objednávka</th>
                        <th>Suma</th>
                        <th>Akcia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nevydane.map((rec) => {
                        const pol = rec?.polozky || {};
                        const items = Object.entries(pol).map(([n, ks]) => `${ks}× ${n}`).join(", ");
                        const prilohy = Object.values(rec.prilohy || {})
                          .flatMap((ps) => Object.entries(ps).map(([pn, pk]) => `${pk}× ${pn}`))
                          .join(", ");
                        return (
                          <tr key={rec.id} style={{ background: orderColor(rec.objednavkaId || rec.id) }}>
                            <td title={new Date(rec.completedAt || rec.createdAt || Date.now()).toLocaleString()}>
                              {timeAgo(rec.completedAt || rec.createdAt)}
                            </td>
                            <td>
                              <span style={{ fontSize: "0.82em", color: "#6b7280" }}>Objednávka #{rec.orderNumber ?? "—"} · Pípač #{rec.vysielac ?? "—"}</span>
                              <div>{items || "—"}{prilohy && <span className="k-help"> · ↳ {prilohy}</span>}</div>
                            </td>
                            <td>{typeof rec.suma === "number" ? rec.suma.toFixed(2) + " €" : rec.suma || "—"}</td>
                            <td>
                              <button
                                className="k-btn k-btn--success"
                                onClick={() => oznacitPrevzate(rec.id, rec.vysielac ?? null)}
                              >
                                Odovzdať
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PRIPRAVENÉ OBJEDNÁVKY — mobilné karty */}
            {nevydane.length > 0 && (
              <div className="hide-desktop">
                <div className="o-cards">
                  {nevydane.map((rec) => {
                    const pol = rec?.polozky || {};
                    return (
                      <article className="o-card" key={rec.id} style={{ background: orderColor(rec.objednavkaId || rec.id) }}>
                        <header className="o-head">
                          <div>
                            <div className="o-id">Pípač #{rec.vysielac ?? "—"}</div>
                            <div style={{ fontSize: "0.8em", color: "#6b7280", marginTop: 1 }}>Objednávka #{rec.orderNumber ?? "—"}</div>
                          </div>
                          <div className="o-time" title={new Date(rec.completedAt || rec.createdAt || Date.now()).toLocaleString()}>
                            {timeAgo(rec.completedAt || rec.createdAt)}
                          </div>
                        </header>
                        <div className="o-items">
                          {Object.entries(pol).map(([n, ks]) => (
                            <div className="o-item" key={n}>
                              <span className="o-name">{n}</span>
                              <span className="o-qty">{ks}×</span>
                            </div>
                          ))}
                          {Object.values(rec.prilohy || {}).flatMap((ps) =>
                            Object.entries(ps).map(([pn, pk]) => (
                              <div className="o-item" key={pn} style={{ opacity: 0.75, paddingLeft: 8 }}>
                                <span className="o-name">↳ {pn}</span>
                                <span className="o-qty">{pk}×</span>
                              </div>
                            ))
                          )}
                          {Object.keys(pol).length === 0 && <div className="o-empty">—</div>}
                        </div>
                        <div className="o-meta">
                          <div className="o-chip">Suma</div>
                          <div className="o-sum">
                            {typeof rec.suma === "number" ? rec.suma.toFixed(2) + " €" : rec.suma || "—"}
                          </div>
                        </div>
                        <button
                          className="o-btn-primary"
                          onClick={() => oznacitPrevzate(rec.id, rec.vysielac ?? null)}
                        >
                          Odovzdať
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
