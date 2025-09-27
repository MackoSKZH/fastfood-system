import { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import {
  ref,
  set,
  push,
  onValue,
  runTransaction,
  onDisconnect,
  //onChildAdded,
  //query,
  //orderByChild,
  //startAt,
  get,
} from "firebase/database";
import { useNavigate } from "react-router-dom";
import InfoModal from "../components/InfoModal";

import "./kiosk.css";
import RoleHeader from "./RoleHeader";
import { useSession } from "../SessionProvider";

const vysielaceCisla = Array.from({ length: 24 }, (_, i) => i + 1);

export default function Kasa() {
  const navigate = useNavigate();
  const { sessionCode: session } = useSession();

  const [preset, setPreset] = useState("");
  const [vsetkyPresety, setVsetkyPresety] = useState([]);
  const [menu, setMenu] = useState([]);
  const [zablokovaneVysielace, setZablokovaneVysielace] = useState({});
  const [zvolenyVysielac, setZvolenyVysielac] = useState(null);
  const [objednavka, setObjednavka] = useState({});
  const [showInfo, setShowInfo] = useState(false);

  // PREVZATIE cez modal (pre červené "ready")
  const [readyModalOpen, setReadyModalOpen] = useState(false);
  const [readyVysielac, setReadyVysielac] = useState(null);
  const [readyRec, setReadyRec] = useState(null);
  const [prevzateMap, setPrevzateMap] = useState({});

  // trackujeme, či sme vysielač reálne uzamkli (true) a jednorazové preskočenie auto-unlocku po potvrdení
  const mamAktivnyLock = useRef(false);
  const skipAutoUnlockOnce = useRef(false);

  // Presety zoznam
  useEffect(() => {
    const presetsRef = ref(db, "presets");
    const off = onValue(presetsRef, (snap) => {
      const data = snap.val() || {};
      setVsetkyPresety(Object.keys(data));
    });
    return () => off();
  }, []);

  // Session preset
  useEffect(() => {
    if (!session) return;
    const sessionRef = ref(db, `sessions/${session}`);
    const off = onValue(sessionRef, (snap) => {
      const data = snap.val();
      if (data && data.preset) setPreset(data.preset);
    });
    return () => off();
  }, [session]);

  // Prevzaté logy
  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}/prevzate`), (s) => {
      setPrevzateMap(s.val() || {});
    });
    return () => off();
  }, [session]);

  // Načítaj položky pre modal, keď je vybraný "ready" vysielač
  useEffect(() => {
    if (!session || readyVysielac == null) {
      setReadyRec(null);
      return;
    }
    const off = onValue(ref(db, `sessions/${session}/log`), (s) => {
      const data = s.val() || {};
      const list = Object.entries(data)
        .map(([id, rec]) => ({ id, ...rec }))
        .filter((r) => r.vysielac === readyVysielac && !prevzateMap[r.id])
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      setReadyRec(list[0] || null);
    });
    return () => off();
  }, [session, readyVysielac, prevzateMap]);

  // Menu pre aktuálny preset
  useEffect(() => {
    if (!preset) return;
    const presetRef = ref(db, `presets/${preset}`);
    const offMenu = onValue(presetRef, (snapshot) => {
      const data = snapshot.val() || {};
      const arr = Object.entries(data).map(([nazov, v]) => ({
        nazov,
        cena: Number((v && v.cena) ?? 0),
      }));
      setMenu(arr);
    });
    return () => offMenu();
  }, [preset]);

  // Stav vysielačov
  useEffect(() => {
    if (!session) return;
    const vysRef = ref(db, `sessions/${session}/vysielace`);
    const off = onValue(vysRef, (snap) => {
      setZablokovaneVysielace(snap.val() || {});
    });
    return () => off();
  }, [session]);

  // SessionStorage init
  useEffect(() => {
    const ulozenyPreset = sessionStorage.getItem("preset");
    const ulozenyVysielac = sessionStorage.getItem("zvolenyVysielac");
    if (ulozenyPreset) setPreset(ulozenyPreset);
    if (ulozenyVysielac) setZvolenyVysielac(Number(ulozenyVysielac));

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

  // Auto-unlock len ak sme reálne zamkli a nepreskakujeme ho po potvrdení
  useEffect(() => {
    const unlockIfNeeded = async () => {
      if (!session || zvolenyVysielac == null) return;
      if (skipAutoUnlockOnce.current) {
        // preskoč jednorazovo (návrat po potvrdení objednávky)
        skipAutoUnlockOnce.current = false;
        return;
      }
      if (!mamAktivnyLock.current) return;
      try {
        await set(ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`), null);
      } catch (e) {
        console.error("Chyba pri auto-unlocku:", e);
      } finally {
        mamAktivnyLock.current = false;
      }
    };
    return () => {
      unlockIfNeeded();
    };
  }, [session, zvolenyVysielac]);

  /*
  useEffect(() => {
    if (!session) return;
    const since = Date.now();
    const q = query(
      ref(db, `sessions/${session}/log`),
      orderByChild("completedAt"),
      startAt(since)
    );
    const off = onChildAdded(q, (snap) => {
      const rec = snap.val() || {};
      const vys = rec?.vysielac ?? "—";
      const pol = rec?.polozky || {};
      const summary = Object.entries(pol)
        .map(([n, ks]) => `${ks}× ${n}`)
        .join(", ");
    });
    return () => off();
  }, [session]);
  */

  // Výber vysielača z gridu
  async function vybratVysielac(cislo) {
    if (!session) return;
    const lockRef = ref(db, `sessions/${session}/vysielace/${cislo}`);

    try {
      const snap = await get(lockRef);
      const val = snap.val();

      // klik na "prevzate" → len odomkni
      if (val === "prevzate") {
        await set(lockRef, null);
        return;
      }

      // klik na "ready" → otvor MODAL (bez locku)
      if (val === "ready") {
        setReadyVysielac(cislo);
        setReadyModalOpen(true);
        try { await onDisconnect(lockRef).cancel(); } catch {}
        return;
      }
    } catch {}

    // bežný lock pre tvorbu objednávky
    try {
      const res = await runTransaction(
        lockRef,
        (current) => {
          if (current === true || current === "locked") return;  // už zamknutý
          if (current === "prevzate") return;                     // zelený neprepisuj
          if (current === "ready") return current;                // červený nelockuj
          return true;                                            // nastav lock
        },
        { applyLocally: false }
      );

      if (res.committed) {
        const v = res.snapshot?.val();
        if (v === true || v === "locked" || v === true || v == null) {
          setZvolenyVysielac(cislo);
          mamAktivnyLock.current = true;              // máme aktívny lock
          try { await onDisconnect(lockRef).remove(); } catch {}
        } else if (v === "ready") {
          // fallback – ako hore: otvor modal
          setReadyVysielac(cislo);
          setReadyModalOpen(true);
          mamAktivnyLock.current = false;
          try { await onDisconnect(lockRef).cancel(); } catch {}
        }
      } else {
        const v = res.snapshot?.val();
        if (v === true || v === "locked") {
        } else if (v === "prevzate") {
        }
      }
    } catch (e) {
      console.error("Chyba pri výbere vysielača:", e);
    }
  }

  async function safeReleaseLock() {
    if (!session || zvolenyVysielac == null) return;
    const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
    try {
      try { await onDisconnect(lockRef).cancel(); } catch {}
      if (mamAktivnyLock.current) {
        await set(lockRef, null);
      }
    } catch (e) {
      console.error("Chyba pri uvoľnení vysielača:", e);
    } finally {
      mamAktivnyLock.current = false;
      setZvolenyVysielac(null);
      setObjednavka({});
      sessionStorage.removeItem("zvolenyVysielac");
    }
  }

  async function spatKVysielacom() {
    await safeReleaseLock();
  }

  // ODOVZDAŤ (ready -> normálny stav) cez modal
  async function odovzdatAktualny() {
    if (!session || !readyRec || readyVysielac == null) return;

    await set(ref(db, `sessions/${session}/prevzate/${readyRec.id}`), true);
    // po odovzdaní rovno VOĽNÝ
    await set(ref(db, `sessions/${session}/vysielace/${readyVysielac}`), null);

    try { await onDisconnect(ref(db, `sessions/${session}/vysielace/${readyVysielac}`)).cancel(); } catch {}

    setReadyRec(null);
    setReadyModalOpen(false);
    setReadyVysielac(null);
  }

  function zavrietReadyModal() {
    setReadyModalOpen(false);
    setReadyVysielac(null);
    setReadyRec(null);
  }

  async function zrusitObjednavku() {
    if (Object.keys(objednavka).length === 0) {
      await safeReleaseLock();
      return;
    }
    const ok = window.confirm("Zrušiť rozpracovanú objednávku?");
    if (!ok) return;
    setObjednavka({});
  }

  function pridajPolozku(nazov) {
    setObjednavka((prev) => ({ ...prev, [nazov]: (prev[nazov] || 0) + 1 }));
  }

  function odobratPolozku(nazov) {
    setObjednavka((prev) => {
      const k = { ...prev };
      if (k[nazov] > 1) k[nazov]--;
      else delete k[nazov];
      return k;
    });
  }

  function spocitajCenu() {
    return Object.entries(objednavka).reduce((sum, [nazov, pocet]) => {
      const p = menu.find((m) => m.nazov === nazov);
      return sum + ((p && p.cena) || 0) * (pocet || 0);
    }, 0);
  }

  async function potvrditObjednavku() {
    try {
      if (!session) {
        return;
      }
      if (!zvolenyVysielac) {
        return;
      }
      if (Object.keys(objednavka).length === 0) {
        return;
      }

      const ordersRef = ref(db, `sessions/${session}/objednavky`);
      const newRef = push(ordersRef);
      await set(newRef, {
        vysielac: zvolenyVysielac,
        polozky: objednavka,
        suma: spocitajCenu(),
        status: "waiting",
        timestamp: Date.now(),
      });

      // po potvrdení nech vysielač ZOSTANE zamknutý (true)
      const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
      try { await onDisconnect(lockRef).cancel(); } catch {}
      await set(lockRef, true);
      mamAktivnyLock.current = true;

      // vrátime sa na grid, ale BEZ auto-unlocku pri cleanup-e
      skipAutoUnlockOnce.current = true;
      setObjednavka({});
      setZvolenyVysielac(null);

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

  if (!session) return null;

  return (
    <>
      <RoleHeader />
      <div className="k-wrap">
        {/* TOP BAR */}
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

        {/* GRID: MENU + KOŠÍK */}
        <div className="k-grid">
          <div className="k-col">
            {/* PANEL VYSIELAČOV */}
            {!zvolenyVysielac && (
              <div className="k-panel">
                <h2 className="k-title">Zvoľte vysielač</h2>
                <div className="k-vysielace">
                  {vysielaceCisla.map((cislo) => {
                    const state = zablokovaneVysielace[cislo];
                    const isLocked   = state === true || state === "locked";
                    const isReady    = state === "ready";
                    const isPrevzate = state === "prevzate";
                    const btnClass = isLocked ? "locked" : isReady ? "ready" : isPrevzate ? "prevzate" : "free";
                    const title = isLocked
                      ? "Zablokovaný"
                      : isReady
                      ? "Pripravený na odovzdanie"
                      : isPrevzate
                      ? "Prevzatý – ťuknutím odomkneš"
                      : "Voľný";

                    return (
                      <button
                        key={cislo}
                        className={`k-vys-btn ${btnClass}`}
                        disabled={isLocked}
                        onClick={() => vybratVysielac(cislo)}
                        title={title}
                      >
                        {cislo}
                        {state && (
                          <span className="k-flag">
                            {isPrevzate ? "PREV" : isReady ? "READY" : "LOCK"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="k-help" style={{ marginTop: 8 }}>
                  Najprv zvoľte vysielač. Potom sa zobrazí ponuka.
                </div>
              </div>
            )}

            {/* MENU GRID – klasická tvorba objednávky */}
            {zvolenyVysielac && (
              <div className="k-panel" style={{ marginTop: 12 }}>
                <h2 className="k-title">Vysielač #{zvolenyVysielac}</h2>
                <div className="k-menu">
                  {menu.length === 0 && <i>Menu je prázdne.</i>}
                  {menu.map((p) => {
                    const count = objednavka[p.nazov] || 0;
                    return (
                      <div className="k-card" key={p.nazov}>
                        <div className="name">{p.nazov}</div>
                        <div className="price">€{p.cena.toFixed(2)}</div>
                        <div className="actions">
                          <button className="k-btn primary" onClick={() => pridajPolozku(p.nazov)}>Pridať</button>
                          {count > 0 && (
                            <div className="k-qty">
                              <button className="k-btn" onClick={() => odobratPolozku(p.nazov)} aria-label="Odobrať">–</button>
                              <strong>{count}</strong>
                              <button className="k-btn" onClick={() => pridajPolozku(p.nazov)} aria-label="Pridať">+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* STICKY KOŠÍK */}
          <aside className="k-panel k-cart">
            <h3 style={{ marginTop: 0 }}>Moja objednávka</h3>
            {Object.keys(objednavka).length === 0 ? (
              <p className="k-help">Žiadne položky. Pridajte z ponuky.</p>
            ) : (
              <>
                <div>
                  {Object.entries(objednavka).map(([nazov, pocet]) => {
                    const pol = menu.find((m) => m.nazov === nazov);
                    const cena = (pol?.cena || 0) * pocet;
                    return (
                      <div key={nazov} className="row">
                        <div style={{ maxWidth: 220 }}>
                          <strong>{nazov}</strong>{" "}
                          <span className="k-help">×{pocet}</span>
                        </div>
                        <div>€{cena.toFixed(2)}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="row" style={{ borderBottom: "none", paddingTop: 10 }}>
                  <div className="sum">Spolu</div>
                  <div className="sum">€{spocitajCenu().toFixed(2)}</div>
                </div>

                <div className="k-row" style={{ marginTop: 12 }}>
                  <button className="k-btn" onClick={spatKVysielacom}>Späť k vysielačom</button>
                  <button className="k-btn" onClick={zrusitObjednavku}>Zrušiť objednávku</button>
                  <button className="k-btn accent" onClick={potvrditObjednavku}>Potvrdiť objednávku</button>
                </div>
                <div className="k-help">Po potvrdení sa vysielač uzamkne.</div>
              </>
            )}
          </aside>
        </div>
      </div>

      {/* READY MODAL */}
      {readyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="k-modal-backdrop"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) zavrietReadyModal();
          }}
        >
          <div
            className="k-modal"
            style={{
              background: "#fff", borderRadius: 12, padding: 16, width: "min(680px, 92vw)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>
                Vysielač #{readyVysielac} — pripravené na odovzdanie
              </h3>
              <button className="k-btn" onClick={zavrietReadyModal} aria-label="Zavrieť">✕</button>
            </div>

            {!readyRec ? (
              <p className="k-help">Načítavam objednávku…</p>
            ) : (
              <>
                <div className="k-table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
                  <table className="k-table">
                    <thead>
                      <tr><th>Položka</th><th>Ks</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(readyRec.polozky || {}).map(([n, ks]) => (
                        <tr key={n}><td>{n}</td><td><b>{ks}</b></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="k-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
                  <div className="k-sum">
                    Suma: <b>{Number(readyRec.suma || 0).toFixed(2)} €</b>
                  </div>
                  <div className="k-row">
                    <button className="k-btn" onClick={zavrietReadyModal}>Zrušiť</button>
                    <button className="k-btn primary" onClick={odovzdatAktualny}>ODOVZDAŤ</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
