import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { ref, onValue, get, push, set, runTransaction, remove } from "firebase/database";
import "./kiosk.css";
import "./kuchyna.css";
import RoleHeader from "./RoleHeader";
import { useSession } from "../SessionProvider";

export default function Kuchyna() {
  const { sessionCode: session } = useSession();
  const [objednavky, setObjednavky] = useState([]);
  const [checked, setChecked] = useState({}); // zdieľaný stav z DB
  const [now, setNow] = useState(Date.now());

  const [showInfo, setShowInfo] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    byItem: [],
    from: null,
    to: null,
  });

  // ---- stránkovanie ----
  const pageSize = 3;
  const [page, setPage] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // objednávky
  useEffect(() => {
    if (!session) return;
    const objednavkyRef = ref(db, `sessions/${session}/objednavky`);
    const unsub = onValue(objednavkyRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      setObjednavky(arr);
    });
    return () => unsub();
  }, [session]);

  // zdieľané checkboxy
  useEffect(() => {
    if (!session) return;
    const checksRef = ref(db, `sessions/${session}/kuchynaChecks`);
    const off = onValue(checksRef, (s) => setChecked(s.val() || {}));
    return () => off();
  }, [session]);

  // Info/štatistiky
  useEffect(() => {
    if (!showInfo || !session) return;

    let off = null;
    (async () => {
      const sessionSnap = await get(ref(db, `sessions/${session}`));
      const presetName = sessionSnap.exists() ? sessionSnap.val()?.preset || "" : "";

      let priceMap = {};
      const norm = (s) =>
        (s ?? "")
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ");
      if (presetName) {
        const presetSnap = await get(ref(db, `presets/${presetName}`));
        const presetData = presetSnap.val() || {};
        Object.entries(presetData).forEach(([nazov, v]) => {
          let cena =
            typeof v === "number"
              ? v
              : v && typeof v.cena !== "undefined"
              ? Number(v.cena)
              : v && typeof v.price !== "undefined"
              ? Number(v.price)
              : 0;
          if (!Number.isFinite(cena)) cena = 0;
          priceMap[nazov] = cena;
          priceMap[norm(nazov)] = cena;
        });
      }
      const getCena = (nazov) => priceMap[nazov] ?? priceMap[norm(nazov)] ?? 0;

      const logRef = ref(db, `sessions/${session}/log`);
      off = onValue(logRef, (snap) => {
        const data = snap.val() || {};
        let totalOrders = 0;
        let totalRevenue = 0;
        const counts = {};
        let from = null,
          to = null;

        Object.values(data).forEach((rec) => {
          totalOrders += 1;
          totalRevenue += Number(rec?.suma || 0);
          const t = Number(rec?.completedAt || rec?.timestamp || 0);
          if (t) {
            if (from === null || t < from) from = t;
            if (to === null || t > to) to = t;
          }
          const pol = rec?.polozky || {};
          Object.entries(pol).forEach(([nazov, ks]) => {
            counts[nazov] = (counts[nazov] || 0) + Number(ks || 0);
          });
        });

        const byItem = Object.entries(counts)
          .map(([nazov, ks]) => {
            const cena = Number(getCena(nazov) || 0);
            const trzba = ks * cena;
            return { nazov, ks, cena, trzba };
          })
          .sort(
            (a, b) =>
              b.trzba - a.trzba ||
              b.ks - a.ks ||
              a.nazov.localeCompare(b.nazov, "sk")
          );

        setStats({ totalOrders, totalRevenue, byItem, from, to });
      });
    })();

    return () => {
      if (off) off();
    };
  }, [showInfo, session]);

  // čakajúce objednávky, VIP dopredu
  const waitingOrders = useMemo(() => {
    const VIP = new Set(["01", "02", "03", "04"]);
    return objednavky
      .filter((o) => o?.status === "waiting")
      .sort((a, b) => {
        const pa = VIP.has(String(a.vysielac)) ? 0 : 1;
        const pb = VIP.has(String(b.vysielac)) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.timestamp || 0) - (b.timestamp || 0);
      });
  }, [objednavky]);

  // stránky
  const pageCount = Math.max(1, Math.ceil(waitingOrders.length / pageSize));
  useEffect(() => {
    setPage((p) => Math.min(Math.max(0, p), pageCount - 1));
  }, [pageCount]);

  const visibleOrders = useMemo(() => {
    const start = page * pageSize;
    return waitingOrders.slice(start, start + pageSize);
  }, [waitingOrders, page]);

  // výpočet „Zostáva pripraviť“ (odpočítava zaškrtnuté z aktuálnej stránky)
  const toPrep = useMemo(() => {
    const sum = {};
    waitingOrders.forEach((o) => {
      Object.entries(o.polozky || {}).forEach(([nazov, pocet]) => {
        sum[nazov] = (sum[nazov] || 0) + Number(pocet || 0);
      });
    });

    visibleOrders.forEach((o) => {
      const m = checked[o.id] || {};
      Object.entries(m).forEach(([key, v]) => {
        if (!v) return;
        const nazov = key.replace(/-\d+$/, "");
        if (sum[nazov]) sum[nazov] = Math.max(0, sum[nazov] - 1);
      });
    });

    const items = Object.entries(sum)
      .map(([nazov, ks]) => ({ nazov, ks }))
      .filter((r) => r.ks > 0)
      .sort((a, b) => b.ks - a.ks || a.nazov.localeCompare(b.nazov, "sk"));

    const total = items.reduce((t, r) => t + r.ks, 0);
    return { items, total };
  }, [waitingOrders, visibleOrders, checked]);

  function totalItemsInOrder(order) {
    return Object.values(order?.polozky || {}).reduce(
      (sum, ks) => sum + Number(ks || 0),
      0
    );
  }

  function isOrderComplete(order) {
    const m = checked[order.id] || {};
    const checkedTrue = Object.values(m).filter(Boolean).length;
    const expected = totalItemsInOrder(order);
    return expected > 0 && checkedTrue >= expected;
  }

  // toggle zapisuje do DB (zdieľané)
  function toggleItem(orderId, itemKey) {
    if (!session) return;
    const cellRef = ref(db, `sessions/${session}/kuchynaChecks/${orderId}/${itemKey}`);
    runTransaction(cellRef, (cur) => !cur);
  }

  // priebežný cleanup: odstráň checky pre objednávky, ktoré už nie sú 'waiting'
  useEffect(() => {
    if (!session) return;
    const waitingIds = new Set(waitingOrders.map((o) => o.id));
    Object.keys(checked || {}).forEach((orderId) => {
      if (!waitingIds.has(orderId)) {
        remove(ref(db, `sessions/${session}/kuchynaChecks/${orderId}`));
      }
    });
  }, [session, waitingOrders, checked]);

  function formatElapsed(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = m.toString().padStart(2, "0");
    const ss = s.toString().padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  function elapsedColor(ms) {
    if (ms >= 15 * 60 * 1000) return "#dc2626";
    if (ms >= 8 * 60 * 1000) return "#d97706";
    return "#059669";
  }

  async function hotovo(order) {
    try {
      const logRef = ref(db, `sessions/${session}/log`);
      const newLog = push(logRef);
      await set(newLog, {
        objednavkaId: order.id,
        vysielac: order.vysielac,
        polozky: order.polozky,
        suma: order.suma || 0,
        completedAt: Date.now(),
        createdAt: order.timestamp || null,
      });
      await set(ref(db, `sessions/${session}/vysielace/${order.vysielac}`), "ready");
      await set(ref(db, `sessions/${session}/objednavky/${order.id}`), null);
      // vyčisti zdieľané checkboxy pre túto objednávku
      await remove(ref(db, `sessions/${session}/kuchynaChecks/${order.id}`));
    } catch (e) {
      console.error("HOTOVO zlyhalo:", e);
    }
  }

  if (!session) return null;

  return (
    <>
      <RoleHeader />
      <div className="kitchen-page">
        <div className="k-top">
          <div className="k-row" style={{ justifyContent: "space-between", width: "100%" }}>
            <div className="k-row">
              <button className="k-btn" onClick={() => setShowInfo(true)}>Info</button>
              <h1 style={{ margin: 0 }}>
                Kuchyňa
              </h1>
            </div>
            <div className="k-row">
              <button
                className="k-btn"
                onClick={() => setShowPrep((v) => !v)}
                title="Zobraziť, koľko ešte treba pripraviť"
              >
                {showPrep ? "Skryť zoznam" : "Zostáva pripraviť"}
              </button>
            </div>
          </div>
        </div>

        {/* Panel Zostáva pripraviť */}
        {showPrep && (
          <div className="k-panel" style={{ marginTop: 10 }}>
            <div className="k-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>Zostáva pripraviť</h3>
              <div className="muted">Spolu kusov: <strong>{toPrep.total}</strong></div>
            </div>
            <div className="k-table-wrap" style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
              <table className="k-table">
                <thead>
                  <tr>
                    <th>Položka</th>
                    <th style={{ textAlign: "right" }}>Ks</th>
                  </tr>
                </thead>
                <tbody>
                  {toPrep.items.length ? (
                    toPrep.items.map((r) => (
                      <tr key={r.nazov}>
                        <td>{r.nazov}</td>
                        <td style={{ textAlign: "right" }}><strong>{r.ks}</strong></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="muted">Všetko dobieha — aktuálne nič nečaká.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="k-help" style={{ marginTop: 6 }}>
              Počty sú zo všetkých čakajúcich objednávok; z aktuálnej stránky odpočítavame už odškrtnuté kusy.
            </div>
          </div>
        )}

        {waitingOrders.length === 0 ? (
          <p className="muted">Žiadne objednávky zatiaľ.</p>
        ) : (
          <div className="orders-wrap">
            {/* Pager šípky (pozície/zelene rieši CSS v kuchyna.css) */}
            <button
              className="pager left"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Predošlé objednávky"
              title="Predošlé objednávky"
            >
              ‹
            </button>
            <button
              className="pager right"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              aria-label="Ďalšie objednávky"
              title="Ďalšie objednávky"
            >
              ›
            </button>

            <div className="orders-grid">
              {visibleOrders.map((o) => {
                const elapsedMs = Math.max(0, now - (o.timestamp || now));
                const complete = isOrderComplete(o);
                return (
                  <div key={o.id} className="order-card">
                    <div className="order-head">
                      <strong>#{o.vysielac}</strong>
                      <span
                        className="timer"
                        title="Ako dlho je objednávka na dráte"
                        style={{ background: elapsedColor(elapsedMs) }}
                      >
                        {formatElapsed(elapsedMs)}
                      </span>
                    </div>

                    <div className="order-items">
                      {o.polozky &&
                        Object.entries(o.polozky).flatMap(([nazov, pocet]) =>
                          Array.from({ length: Number(pocet || 0) }, (_, idx) => {
                            const key = `${nazov}-${idx}`;
                            return (
                              <label key={key} className="row item">
                                <span className="name">{nazov}</span>
                                <input
                                  type="checkbox"
                                  checked={!!checked[o.id]?.[key]}
                                  onChange={() => toggleItem(o.id, key)}
                                />
                              </label>
                            );
                          })
                        )}
                    </div>
                    <div className="sum">Suma: €{(o.suma || 0).toFixed(2)}</div>

                    {complete && (
                      <div className="order-actions">
                        <button className="btn done" onClick={() => hotovo(o)}>
                          HOTOVO
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pager-indicator">
              Strana {page + 1} / {pageCount}
            </div>
          </div>
        )}

        {/* INFO modal */}
        {showInfo && (
          <div className="modal">
            <div className="backdrop" onClick={() => setShowInfo(false)} />
            <div className="sheet">
              <div className="modal-head">
                <h3>Prehľad predaja</h3>
                <button className="btn" onClick={() => setShowInfo(false)}>
                  Zavrieť
                </button>
              </div>

              <div className="muted">
                Session {session}
                {stats?.from && (
                  <>
                    {" "}
                    · {new Date(stats.from).toLocaleTimeString()} –{" "}
                    {new Date(stats.to).toLocaleTimeString()}
                  </>
                )}
              </div>

              <div className="panel mt">
                <div className="row spread">
                  <div><strong>Objednávky:</strong> {stats?.totalOrders || 0}</div>
                  <div>
                    <strong>Tržba spolu:</strong> €{(stats?.totalRevenue || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Položka</th>
                      <th style={{ textAlign: "right" }}>Kusy</th>
                      <th style={{ textAlign: "right" }}>Cena/ks</th>
                      <th style={{ textAlign: "right" }}>Tržba</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats?.byItem || []).map((r) => (
                      <tr key={r.nazov}>
                        <td>{r.nazov}</td>
                        <td style={{ textAlign: "right" }}>{r.ks}</td>
                        <td style={{ textAlign: "right" }}>€{(r.cena || 0).toFixed(2)}</td>
                        <td style={{ textAlign: "right" }}>
                          <strong>€{(r.trzba || 0).toFixed(2)}</strong>
                        </td>
                      </tr>
                    ))}
                    {(!stats?.byItem || stats.byItem.length === 0) && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Zatiaľ žiadne dokončené objednávky.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
