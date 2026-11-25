import { useState } from "react";

// session/logZaznamy/tlacim/onPrint prichádzajú z Kasa.js – logZaznamy sú tam už
// aj tak načítané (sessions/{session}/log), netreba duplicitný Firebase listener.
export default function HistoryModal({ session, logZaznamy, tlacim, onPrint, onClose }) {
  const [rozbalene, setRozbalene] = useState({});

  function toggleRozbalene(id) {
    setRozbalene((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  return (
    <div className="modal" onClick={handleBackdropClick}>
      <div className="backdrop" />
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>História objednávok</h3>
          <button className="btn" onClick={onClose} type="button">Zavrieť</button>
        </div>

        <div className="muted">Session {session} · {logZaznamy.length} objednávok</div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Čas</th>
                <th>Objednávka</th>
                <th style={{ textAlign: "right" }}>Suma</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logZaznamy.map((rec) => {
                const pol = rec?.polozky || {};
                const items = Object.entries(pol).map(([n, ks]) => `${ks}× ${n}`).join(", ");
                const prilohy = Object.values(rec.prilohy || {})
                  .flatMap((ps) => Object.entries(ps).map(([pn, pk]) => `${pk}× ${pn}`))
                  .join(", ");
                const otvorene = !!rozbalene[rec.id];
                const cas = rec.completedAt || rec.createdAt || Date.now();
                return (
                  <tr key={rec.id}>
                    <td title={new Date(cas).toLocaleString()}>{new Date(cas).toLocaleTimeString()}</td>
                    <td>
                      <div style={{ cursor: "pointer" }} onClick={() => toggleRozbalene(rec.id)}>
                        <span style={{ fontSize: "0.82em", color: "#6b7280" }}>
                          Objednávka #{rec.orderNumber ?? "—"} · Pípač #{rec.vysielac ?? "—"} {otvorene ? "▲" : "▼"}
                        </span>
                      </div>
                      {otvorene && (
                        <div style={{ marginTop: 4 }}>
                          <div>{items || "—"}</div>
                          {prilohy && <div className="k-help">↳ {prilohy}</div>}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {typeof rec.suma === "number" ? rec.suma.toFixed(2) + " €" : rec.suma || "—"}
                    </td>
                    <td>
                      <button className="k-btn" disabled={tlacim} onClick={() => onPrint(rec)} title="Vytlačiť bloček">
                        🖨️
                      </button>
                    </td>
                  </tr>
                );
              })}
              {logZaznamy.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">Zatiaľ žiadne objednávky.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
