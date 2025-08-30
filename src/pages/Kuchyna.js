import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { ref, onValue, get, push, set } from "firebase/database";
import "./kiosk.css";
import { useToast } from "../ui/toast";

export default function Kuchyna() {
  const [session, setSession] = useState("");
  const [platnaSession, setPlatnaSession] = useState(false);
  const [objednavky, setObjednavky] = useState([]);
  const [checked, setChecked] = useState({});
  const [now, setNow] = useState(Date.now());

  const toast = useToast();

  // INFO modal stav + dáta
  const [showInfo, setShowInfo] = useState(false);
  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, byItem: [], from: null, to: null });

  // tick pre trvanie
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // LIVE objednávky
  useEffect(() => {
    if (!platnaSession || !session) return;
    const objednavkyRef = ref(db, `sessions/${session}/objednavky`);
    const unsub = onValue(objednavkyRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      setObjednavky(arr);
    });
    return () => unsub();
  }, [platnaSession, session]);

  // INFO: čítanie logu len keď je otvorené okno
  useEffect(() => {
    if (!showInfo || !session || !platnaSession) return;
    const logRef = ref(db, `sessions/${session}/log`);
    const off = onValue(logRef, (snap) => {
      const data = snap.val() || {};
      let totalOrders = 0;
      let totalRevenue = 0;
      const counts = {};
      let from = null, to = null;

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
        .map(([nazov, ks]) => ({ nazov, ks }))
        .sort((a, b) => b.ks - a.ks);

      setStats({ totalOrders, totalRevenue, byItem, from, to });
    });
    return () => off();
  }, [showInfo, session, platnaSession]);

  // 3 najstaršie waiting
  const topTri = useMemo(() => {
    return objednavky
      .filter((o) => o?.status === "waiting")
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(0, 3);
  }, [objednavky]);

  // udržiavanie checkbox máp
  useEffect(() => {
    setChecked((prev) => {
      const next = { ...prev };
      const visibleIds = new Set(topTri.map((o) => o.id));
      Object.keys(next).forEach((oid) => {
        if (!visibleIds.has(oid)) delete next[oid];
      });
      topTri.forEach((o) => {
        if (!next[o.id]) {
          next[o.id] = {};
          Object.keys(o.polozky || {}).forEach((nazov) => {
            next[o.id][nazov] = false;
          });
        }
      });
      return next;
    });
  }, [topTri]);

  function isOrderComplete(orderId) {
    const m = checked[orderId] || {};
    const vals = Object.values(m);
    return vals.length > 0 && vals.every(Boolean);
  }

  function toggleItem(orderId, itemName) {
    setChecked((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || {}),
        [itemName]: !(prev[orderId]?.[itemName]),
      },
    }));
  }

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

      if (order.vysielac != null) {
        await set(ref(db, `sessions/${session}/vysielace/${order.vysielac}`), null);
      }
      await set(ref(db, `sessions/${session}/objednavky/${order.id}`), null);
    } catch (e) {
      console.error("HOTOVO zlyhalo:", e);
      toast.error("Nepodarilo sa uzavrieť objednávku.");
    }
  }

  async function pripojitSa() {
    if (!session || session.length !== 4) {
      toast.warn("Zadajte 4-miestny kód.");
      return;
    }
    const snap = await get(ref(db, `sessions/${session}`));
    if (!snap.exists()) {
      toast.error("Session s týmto kódom neexistuje.");
      return;
    }
    setPlatnaSession(true);
  }

  if (!platnaSession) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Pripojenie ku kuchyni</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            maxLength={4}
            placeholder="Zadaj kód session"
            value={session}
            onChange={(e) =>
              setSession(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
          />
          <button onClick={pripojitSa}>Pripojiť sa</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      {/* Horný rad s Info */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={()=>setShowInfo(true)} style={{ padding:"8px 12px", borderRadius:8, border:"1px solid #ddd", cursor:"pointer" }}>Info</button>
          <h1 style={{ margin:0 }}>
            Kuchyňa — session: <code>{session}</code>
          </h1>
        </div>
      </div>

      {topTri.length === 0 ? (
        <p>Žiadne objednávky zatiaľ.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(240px, 1fr))",
            gap: 12,
            alignItems: "start",
          }}
        >
          {topTri.map((o) => {
            const elapsedMs = Math.max(0, now - (o.timestamp || now));
            const complete = isOrderComplete(o.id);
            return (
              <div
                key={o.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: 12,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  minHeight: 160,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>#{o.vysielac}</strong>
                  <span
                    title="Ako dlho je objednávka na dráte"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: elapsedColor(elapsedMs),
                      color: "white",
                    }}
                  >
                    {formatElapsed(elapsedMs)}
                  </span>
                </div>

                <div style={{ marginTop: 8 }}>
                  {o.polozky &&
                    Object.entries(o.polozky).map(([nazov, pocet]) => (
                      <label
                        key={nazov}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 0",
                          borderBottom: "1px dashed #eee",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!checked[o.id]?.[nazov]}
                          onChange={() => toggleItem(o.id, nazov)}
                        />
                        <span style={{ flex: 1 }}>
                          {nazov} <span style={{ opacity: 0.7 }}>×{pocet}</span>
                        </span>
                      </label>
                    ))}
                </div>

                <div style={{ marginTop: 10, fontWeight: 600 }}>
                  Suma: €{(o.suma || 0).toFixed(2)}
                </div>

                {complete && (
                  <button
                    onClick={() => hotovo(o)}
                    style={{
                      marginTop: 12,
                      width: "100%",
                      padding: "8px 10px",
                      background: "#16a34a",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    HOTOVO
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* INFO MODAL */}
      {showInfo && (
        <div className="k-modal">
          <div className="k-backdrop" onClick={()=>setShowInfo(false)} />
          <div className="k-sheet">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h3 style={{margin:0}}>Prehľad predaja</h3>
              <button className="k-btn" onClick={()=>setShowInfo(false)}>Zavrieť</button>
            </div>
            <div className="k-help" style={{margin:"8px 0"}}>
              Session {session}
              {stats?.from && <> · {new Date(stats.from).toLocaleTimeString()} – {new Date(stats.to).toLocaleTimeString()}</>}
            </div>
            <div className="k-panel" style={{marginTop:8}}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <div><strong>Objednávky:</strong> {stats?.totalOrders || 0}</div>
                <div><strong>Tržba spolu:</strong> €{(stats?.totalRevenue || 0).toFixed(2)}</div>
              </div>
            </div>
            <div style={{marginTop:12, maxHeight:"50vh", overflow:"auto"}}>
              <table className="k-table">
                <thead>
                  <tr><th>Položka</th><th style={{textAlign:"right"}}>Predané ks</th></tr>
                </thead>
                <tbody>
                  {(stats?.byItem || []).map(r=>(
                    <tr key={r.nazov}>
                      <td>{r.nazov}</td>
                      <td style={{textAlign:"right"}}>{r.ks}</td>
                    </tr>
                  ))}
                  {(!stats?.byItem || stats.byItem.length===0) && (
                    <tr><td colSpan={2} className="k-help">Zatiaľ žiadne dokončené objednávky.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
