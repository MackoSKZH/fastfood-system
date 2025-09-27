import { useEffect, useState } from "react";
import { db } from "../firebase";
import { ref, onValue, set, get } from "firebase/database";
import "./kiosk.css";
import "./kuchyna.css";
import RoleHeader from "./RoleHeader";
import { useSession } from "../SessionProvider";

export default function Obsluha() {
  const { sessionCode: session } = useSession();
  const [logZaznamy, setLogZaznamy] = useState([]);
  const [prevzate, setPrevzate] = useState({});
  const [now, setNow] = useState(Date.now());

  const [showInfo, setShowInfo] = useState(false);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    byItem: [],
    from: null,
    to: null,
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!session) return;
    const offLog = onValue(ref(db, `sessions/${session}/log`), (s) => {
      const val = s.val() || {};
      const arr = Object.entries(val)
        .map(([id, rec]) => ({ id, ...rec }))
        .sort(
          (a, b) =>
            (b.completedAt || b.createdAt || 0) -
            (a.completedAt || a.createdAt || 0)
        );
      setLogZaznamy(arr);
    });
    const offPrev = onValue(ref(db, `sessions/${session}/prevzate`), (s) => {
      setPrevzate(s.val() || {});
    });
    return () => {
      offLog();
      offPrev();
    };
  }, [session]);

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

  function timeAgo(ts) {
    const diff = Math.max(1, Math.floor((now - (ts || now)) / 1000));
    if (diff < 60) return `${diff}s`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h`;
  }

  async function oznacitPrevzate(id, vys = null) {
    if (!session) return;
    await set(ref(db, `sessions/${session}/prevzate/${id}`), true);
    if (vys != null) {
      await set(ref(db, `sessions/${session}/vysielace/${vys}`), "prevzate");
    }
  }

  const nevydane = logZaznamy.filter((z) => !prevzate[z.id]);

  if (!session) return null;

  return (
    <>
      <RoleHeader />
      <div className="k-wrap">
        <div className="k-top">
          <div className="k-row" style={{ justifyContent: "space-between", width: "100%" }}>
            <div className="k-row">
              <button className="k-btn" onClick={() => setShowInfo(true)}>Info</button>
              <h1 style={{ margin: 0 }}>
                Obsluha
              </h1>
            </div>
            <div className="k-row">
              <div className="k-badge">Hotovo: <b>{logZaznamy.length}</b></div>
              <div className="k-badge">Nevydané: <b>{nevydane.length}</b></div>
            </div>
          </div>
        </div>

        {/* DESKTOP TABUĽKA */}
        <section className="k-section hide-mobile">
          <div className="k-table-wrap">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Čas</th>
                  <th>Objednávka</th>
                  <th>Vysielač</th>
                  <th>Suma</th>
                  <th>Akcia</th>
                </tr>
              </thead>
              <tbody>
                {nevydane.map((rec) => {
                  const pol = rec?.polozky || {};
                  const items = Object.entries(pol)
                    .map(([n, ks]) => `${ks}× ${n}`)
                    .join(", ");
                  return (
                    <tr key={rec.id}>
                      <td title={new Date(rec.completedAt || rec.createdAt || Date.now()).toLocaleString()}>
                        {timeAgo(rec.completedAt || rec.createdAt)}
                      </td>
                      <td><strong>#{rec.vysielac ?? "—"}</strong> — {items || "—"}</td>
                      <td>{rec.vysielac ?? "—"}</td>
                      <td>
                        {typeof rec.suma === "number"
                          ? rec.suma.toFixed(2) + " €"
                          : rec.suma || "—"}
                      </td>
                      <td>
                        <button
                          className="k-btn k-btn--success"
                          onClick={() => oznacitPrevzate(rec.id, rec.vysielac ?? null)}
                        >
                          Prevzaté
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* MOBILNÉ KARTY */}
        <section className="k-section hide-desktop">
          <div className="o-cards">
            {nevydane.map((rec) => {
              const pol = rec?.polozky || {};
              return (
                <article className="o-card" key={rec.id}>
                  <header className="o-head">
                    <div className="o-id">#{rec.vysielac ?? "—"}</div>
                    <div
                      className="o-time"
                      title={new Date(rec.completedAt || rec.createdAt || Date.now()).toLocaleString()}
                    >
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
                    Prevzaté
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        {/* INFO MODAL */}
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
                  <div>
                    <strong>Objednávky:</strong> {stats?.totalOrders || 0}
                  </div>
                  <div>
                    <strong>Tržba spolu:</strong> €
                    {(stats?.totalRevenue || 0).toFixed(2)}
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
                        <td style={{ textAlign: "right" }}>
                          €{(r.cena || 0).toFixed(2)}
                        </td>
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
