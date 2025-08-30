import { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import {
  ref,
  set,
  push,
  onValue,
  get,
  runTransaction,
  onDisconnect,
  onChildAdded,
  query,
  orderByChild,
  startAt
} from "firebase/database";
import { useNavigate } from "react-router-dom";

import "./kiosk.css";
import { useToast } from "../ui/toast";

const vysielaceCisla = Array.from({ length: 24 }, (_, i) => i + 1);

export default function Obsluha() {
  const navigate = useNavigate();
  const toast = useToast();

  const [session, setSession] = useState("");
  const [kodInput, setKodInput] = useState("");
  const [preset, setPreset] = useState("");
  const [vsetkyPresety, setVsetkyPresety] = useState([]);
  const [menu, setMenu] = useState([]);
  const [zablokovaneVysielace, setZablokovaneVysielace] = useState({});
  const [zvolenyVysielac, setZvolenyVysielac] = useState(null);
  const [objednavka, setObjednavka] = useState({});

  const [showInfo, setShowInfo] = useState(false);
  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, byItem: [], from: null, to: null });

  const mamAktivnyLock = useRef(false);
  const vysielacePanelRef = useRef(null);

  useEffect(() => {
    if (!showInfo || !session) return;
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
  }, [showInfo, session]);

  useEffect(() => {
    const presetsRef = ref(db, "presets");
    const off = onValue(presetsRef, (snap) => {
      const data = snap.val() || {};
      setVsetkyPresety(Object.keys(data));
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (!session) return;
    const sessionRef = ref(db, `sessions/${session}`);
    const off = onValue(sessionRef, (snap) => {
      const data = snap.val();
      if (data && data.preset) setPreset(data.preset);
    });
    return () => off();
  }, [session]);

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

  useEffect(() => {
    if (!session) return;
    const vysRef = ref(db, `sessions/${session}/vysielace`);
    const off = onValue(vysRef, (snap) => {
      setZablokovaneVysielace(snap.val() || {});
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    const ulozena = sessionStorage.getItem("session");
    const ulozenyPreset = sessionStorage.getItem("preset");
    const ulozenyVysielac = sessionStorage.getItem("zvolenyVysielac");

    (async () => {
      if (ulozena) {
        try {
          const snap = await get(ref(db, `sessions/${ulozena}`));
          if (snap.exists()) {
            setSession(ulozena);
            const data = snap.val();
            if (data && data.preset) setPreset(data.preset);
          } else {
            sessionStorage.removeItem("session");
          }
        } catch (e) {
          console.error("Kontrola uloženej session zlyhala:", e);
        }
      }
      if (ulozenyPreset) setPreset(ulozenyPreset);
      if (ulozenyVysielac) setZvolenyVysielac(Number(ulozenyVysielac));

      const y = Number(sessionStorage.getItem("obsluhaScrollY") || "0");
      if (y) requestAnimationFrame(() => window.scrollTo(0, y));
    })();
  }, []);

  useEffect(() => {
    if (session) sessionStorage.setItem("session", session);
  }, [session]);

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
      if (!session || zvolenyVysielac == null || !mamAktivnyLock.current) return;
      try {
        await set(ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`), null);
      } catch (e) {
        console.error("Chyba pri auto-unlocku:", e);
      } finally {
        mamAktivnyLock.current = false;
      }
    };

    const handleBeforeUnload = () => {};
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unlockIfNeeded();
    };
  }, [session, zvolenyVysielac]);

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
      toast.success(
        `Vysielač #${vys} je pripravený na odovzdanie${summary ? ` — ${summary}` : ""}.`,
        { duration: 15000 }
      );
    });
    return () => off();
  }, [session, toast]);


  async function vytvorSession() {
    try {
      let kod;
      let existuje = true;
      while (existuje) {
        kod = Math.floor(1000 + Math.random() * 9000).toString();
        const snap = await get(ref(db, `sessions/${kod}`));
        existuje = snap.exists();
      }
      await set(ref(db, `sessions/${kod}`), {
        createdAt: Date.now(),
        preset: "",
      });
      setSession(kod);
      sessionStorage.setItem("session", kod);
    } catch (err) {
      console.error("Chyba pri vytvorení session:", err);
      toast.error("Nepodarilo sa vytvoriť session. Skúste znova.");
    }
  }

  async function pripojitSa(kod) {
    try {
      if (!kod || kod.length !== 4) {
        toast.warn("Zadajte 4-miestny kód.");
        return;
      }
      const snap = await get(ref(db, `sessions/${kod}`));
      if (!snap.exists()) {
        toast.error("Session s týmto kódom neexistuje.");
        return;
      }
      const data = snap.val();
      setPreset((data && data.preset) || "");
      setSession(kod);
      sessionStorage.setItem("session", kod);
    } catch (err) {
      console.error("Chyba pri pripájaní:", err);
      toast.error("Nepodarilo sa pripojiť k session.");
    }
  }

  async function vybratVysielac(cislo) {
    if (!session) return;
    const lockRef = ref(db, `sessions/${session}/vysielace/${cislo}`);
    try {
      const res = await runTransaction(
        lockRef,
        (current) => {
          if (current === true) return;
          return true;
        },
        { applyLocally: false }
      );

      if (res.committed) {
        setZvolenyVysielac(cislo);
        mamAktivnyLock.current = true;
        try {
          await onDisconnect(lockRef).remove();
        } catch {}
      } else {
        toast.warn(`Vysielač #${cislo} je už zamknutý.`);
      }
    } catch (e) {
      console.error("Chyba pri výbere vysielača:", e);
      toast.error("Nepodarilo sa vybrať vysielač.");
    }
  }

  async function spatKVysielacom() {
    if (!session || zvolenyVysielac == null) return;
    const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
    try {
      try { await onDisconnect(lockRef).cancel(); } catch {}
      await set(lockRef, null);
    } catch (e) {
      console.error("Chyba pri odomykaní vysielača:", e);
    } finally {
      mamAktivnyLock.current = false;
      setZvolenyVysielac(null);
    }
  }

  async function zrusitObjednavku() {
    if (!session || zvolenyVysielac == null) {
      setObjednavka({});
      return;
    }
    const potvrd = window.confirm("Naozaj zrušiť celú objednávku?");
    if (!potvrd) return;

    const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
    try {
      try { await onDisconnect(lockRef).cancel(); } catch {}
      await set(lockRef, null);
    } catch (e) {
      console.error("Chyba pri odomykaní vysielača:", e);
    } finally {
      mamAktivnyLock.current = false;
      setObjednavka({});
      setZvolenyVysielac(null);
    }
  }

  function pridajPolozku(nazov) {
    if (zvolenyVysielac == null) return;
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
      if (!session) return toast.warn("Nie ste v session.");
      if (!zvolenyVysielac) return toast.warn("Najprv vyberte vysielač.");
      if (Object.keys(objednavka).length === 0) return toast.info("Košík je prázdny.");

      const ordersRef = ref(db, `sessions/${session}/objednavky`);
      const newRef = push(ordersRef);
      await set(newRef, {
        vysielac: zvolenyVysielac,
        polozky: objednavka,
        suma: spocitajCenu(),
        status: "waiting",
        timestamp: Date.now(),
      });

      const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
      try { await onDisconnect(lockRef).cancel(); } catch {}
      await set(lockRef, true);

      toast.success("Objednávka bola potvrdená.");
      setObjednavka({});
      setZvolenyVysielac(null);
      if (mamAktivnyLock?.current != null) mamAktivnyLock.current = false;
    } catch (err) {
      console.error("Chyba pri potvrdení objednávky:", err);
      toast.error("Objednávku sa nepodarilo uložiť.");
    }
  }

  async function zmenitPreset(novyPreset) {
    try {
      if (!session) return;
      await set(ref(db, `sessions/${session}/preset`), novyPreset);
      setPreset(novyPreset);
    } catch (err) {
      console.error("Chyba pri zmene presetu:", err);
      toast.error("Nepodarilo sa zmeniť preset.");
    }
  }

  function goToPresety() {
    sessionStorage.setItem("obsluhaScrollY", String(window.scrollY));
    navigate("/presety");
  }
  function scrollNaVysielace() {
    vysielacePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // LOGIN obrazovka
  if (!session) {
    return (
      <div style={{ padding: 20, maxWidth: 420 }}>
        <h2>Pripojenie k akcii (session)</h2>

        <div style={{ margin: "16px 0" }}>
          <button onClick={vytvorSession}>Vytvoriť novú session</button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            maxLength={4}
            value={kodInput}
            onChange={(e) =>
              setKodInput(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="Zadaj existujúci kód (4 čísla)"
          />
          <button onClick={() => pripojitSa(kodInput)}>Pripojiť sa</button>
        </div>
      </div>
    );
  }

  // Hlavné UI
  return (
    <div className="k-wrap">
      {/* TOP BAR */}
      <div className="k-top">
        <div className="k-row" style={{justifyContent:"space-between"}}>
          <div className="k-row">
            <button className="k-btn" onClick={()=>setShowInfo(true)}>Info</button>
            <button className="k-btn" onClick={goToPresety}>Presety</button>
            {vsetkyPresety.length ? (
              <select className="k-select" value={preset} onChange={(e)=>zmenitPreset(e.target.value)}>
                <option value="">-- Vyber preset --</option>
                {vsetkyPresety.map(p=> <option key={p} value={p}>{p}</option>)}
              </select>
            ) : <span className="k-help">Žiadne presety</span>}
          </div>

          <div className="k-row">
            {zvolenyVysielac != null && (
              <button className="k-btn" onClick={spatKVysielacom}>Späť k vysielačom</button>
            )}
            <span className="k-badge">Session {session}</span>
          </div>
        </div>
      </div>

      {/* DVOJSTĹPCOVÝ LAYOUT: MENU + KOŠÍK */}
      <div className="k-grid">
        <div className="k-col">
          {/* PANEL VYSIELAČOV */}
          {!zvolenyVysielac && (
            <div className="k-panel" ref={vysielacePanelRef}>
              <h2 className="k-title">Zvoľte vysielač</h2>
              <div className="k-vysielace">
                {vysielaceCisla.map(cislo=>{
                  const locked = !!zablokovaneVysielace[cislo];
                  return (
                    <button key={cislo}
                            className={`k-vys-btn ${locked? "locked":"free"}`}
                            disabled={locked}
                            onClick={()=>vybratVysielac(cislo)}
                            title={locked?"Zablokovaný":"Voľný"}>
                      {cislo}
                      {locked && <span className="lock">🔒</span>}
                    </button>
                  )
                })}
              </div>
              <div className="k-help" style={{marginTop:8}}>
                Najprv zvoľte vysielač. Potom sa zobrazí ponuka.
              </div>
            </div>
          )}

          {/* MENU GRID */}
          {zvolenyVysielac && (
            <div className="k-panel" style={{marginTop:12}}>
              <h2 className="k-title">Vysielač #{zvolenyVysielac}</h2>
              <div className="k-menu">
                {menu.length===0 && <i>Menu je prázdne.</i>}
                {menu.map(p=>{
                  const count = objednavka[p.nazov] || 0;
                  return (
                    <div className="k-card" key={p.nazov}>
                      <div className="name">{p.nazov}</div>
                      <div className="price">€{p.cena.toFixed(2)}</div>
                      <div className="actions">
                        <button className="k-btn primary" onClick={()=>pridajPolozku(p.nazov)}>+ Pridať</button>
                        {count>0 && (
                          <div className="k-qty">
                            <button className="k-btn" onClick={()=>odobratPolozku(p.nazov)} aria-label="Odobrať">–</button>
                            <strong>{count}</strong>
                            <button className="k-btn" onClick={()=>pridajPolozku(p.nazov)} aria-label="Pridať">+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* STICKY KOŠÍK */}
        <aside className="k-panel k-cart">
          <h3 style={{marginTop:0}}>Moja objednávka</h3>

          {Object.keys(objednavka).length===0 ? (
            <p className="k-help">
              Žiadne položky. {zvolenyVysielac == null ? (
                <>Najprv <button className="k-link" onClick={scrollNaVysielace}>vyber vysielač</button>.</>
              ) : "Pridaj z menu."}
            </p>
          ) : (
            <>
              <div>
                {Object.entries(objednavka).map(([nazov, pocet])=>{
                  const pol = menu.find(m=>m.nazov===nazov);
                  const cena = (pol?.cena||0) * pocet;
                  return (
                    <div key={nazov} className="row">
                      <div style={{maxWidth:220}}>
                        <strong>{nazov}</strong> <span className="k-help">×{pocet}</span>
                      </div>
                      <div>€{cena.toFixed(2)}</div>
                    </div>
                  )
                })}
              </div>

              <div className="row" style={{borderBottom:"none", paddingTop:10}}>
                <div className="sum">Spolu</div>
                <div className="sum">€{spocitajCenu().toFixed(2)}</div>
              </div>

              <div className="k-row" style={{marginTop:12, flexWrap:"wrap"}}>
                {zvolenyVysielac != null ? (
                  <button className="k-btn" onClick={spatKVysielacom}>Späť k vysielačom</button>
                ) : (
                  <button className="k-btn" onClick={scrollNaVysielace}>Vybrať vysielač</button>
                )}
                <button className="k-btn" onClick={zrusitObjednavku}>Zrušiť objednávku</button>
                <button
                  className="k-btn accent"
                  onClick={potvrditObjednavku}
                  disabled={!zvolenyVysielac || Object.keys(objednavka).length===0}
                  title={!zvolenyVysielac ? "Najprv vyber vysielač" : (Object.keys(objednavka).length===0 ? "Košík je prázdny" : "")}
                >
                  Potvrdiť
                </button>
              </div>

              <div className="k-help">
                Po potvrdení zostane daný vysielač zamknutý, kým kuchyňa objednávku neuzavrie.
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ℹ️ INFO MODAL */}
      {showInfo && (
        <div className="k-modal">
          <div className="k-backdrop" onClick={()=>setShowInfo(false)} />
          <div className="k-sheet">
            <div className="k-row" style={{justifyContent:"space-between"}}>
              <h3 style={{margin:0}}>Prehľad predaja</h3>
              <button className="k-btn" onClick={()=>setShowInfo(false)}>Zavrieť</button>
            </div>
            <div className="k-help" style={{margin:"8px 0"}}>
              Session {session}
              {stats?.from && <> · {new Date(stats.from).toLocaleTimeString()} – {new Date(stats.to).toLocaleTimeString()}</>}
            </div>
            <div className="k-panel" style={{marginTop:8}}>
              <div className="k-row" style={{justifyContent:"space-between"}}>
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
