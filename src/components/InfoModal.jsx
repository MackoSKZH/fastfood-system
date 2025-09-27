import { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import { ref, get, onValue } from "firebase/database";

const norm = (s) =>
  (s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

export default function InfoModal({ session, onClose }) {
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    byItem: [],
    from: null,
    to: null,
  });

  // ===== anti-ghost-click =====
  const [armed, setArmed] = useState(false);
  const openTs = useRef(Date.now());
  useEffect(() => {
    openTs.current = Date.now();
    const id = setTimeout(() => setArmed(true), 180);
    return () => clearTimeout(id);
  }, []);

  function handleBackdropClick(e) {
    if (e.target !== e.currentTarget) return;
    if (!armed) return;
    onClose?.();
  }

  useEffect(() => {
    if (!session) return;
    let off = null;

    (async () => {
      const sSnap = await get(ref(db, `sessions/${session}`));
      const presetName = sSnap.exists() ? sSnap.val()?.preset || "" : "";

      let priceMap = {};
      if (presetName) {
        const pSnap = await get(ref(db, `presets/${presetName}`));
        const pData = pSnap.val() || {};
        Object.entries(pData).forEach(([nazov, v]) => {
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
      const getCena = (n) => priceMap[n] ?? priceMap[norm(n)] ?? 0;

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
          Object.entries(rec?.polozky || {}).forEach(([nazov, ks]) => {
            counts[nazov] = (counts[nazov] || 0) + Number(ks || 0);
          });
        });

        const byItem = Object.entries(counts)
          .map(([nazov, ks]) => {
            const cena = Number(getCena(nazov) || 0);
            return { nazov, ks, cena, trzba: ks * cena };
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

    return () => off && off();
  }, [session]);

  return (
    <div className="modal" onClick={handleBackdropClick}>
      <div className="backdrop" /> 
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Prehľad predaja</h3>
          <button className="btn" onClick={onClose} type="button">Zavrieť</button>
        </div>

        <div className="muted">
          Session {session}
          {stats?.from && (
            <> · {new Date(stats.from).toLocaleTimeString()} – {new Date(stats.to).toLocaleTimeString()}</>
          )}
        </div>

        <div className="panel mt">
          <div className="row spread">
            <div><strong>Objednávky:</strong> {stats?.totalOrders || 0}</div>
            <div><strong>Tržba spolu:</strong> €{(stats?.totalRevenue || 0).toFixed(2)}</div>
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
                  <td style={{ textAlign: "right" }}><strong>€{(r.trzba || 0).toFixed(2)}</strong></td>
                </tr>
              ))}
              {(!stats?.byItem || stats.byItem.length === 0) && (
                <tr>
                  <td colSpan={4} className="muted">Zatiaľ žiadne dokončené objednávky.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
