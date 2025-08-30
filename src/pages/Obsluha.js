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
  startAt,
} from "firebase/database";
import { useNavigate } from "react-router-dom";
import { useToast } from "../ui/toast";

import "./kiosk.css";

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

  const [showSessionModal, setShowSessionModal] = useState(false);
  const [novyKodLoading, setNovyKodLoading] = useState(false);
  const [recentSessions, setRecentSessions] = useState([]);

  const mamAktivnyLock = useRef(false);

  useEffect(() => {
    const raw = localStorage.getItem("recentSessions");
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setRecentSessions(arr);
      } catch {}
    }
  }, []);
  function rememberSession(kod) {
    setRecentSessions((prev) => {
      const next = [kod, ...prev.filter((x) => x !== kod)].slice(0, 5);
      localStorage.setItem("recentSessions", JSON.stringify(next));
      return next;
    });
  }
  function forgetSession(kod) {
    setRecentSessions((prev) => {
      const next = prev.filter((x) => x !== kod);
      localStorage.setItem("recentSessions", JSON.stringify(next));
      return next;
    });
  }

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
            rememberSession(ulozena);
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
    window.addEventListener("beforeunload", () => {});
    return () => {
      window.removeEventListener("beforeunload", () => {});
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
      rememberSession(kod);
      toast.success(`Vytvorená nová session ${kod}.`);
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
      rememberSession(kod);
      toast.success(`Pripojené k session ${kod}.`);
    } catch (err) {
      console.error("Chyba pri pripájaní:", err);
      toast.error("Nepodarilo sa pripojiť k session.");
    }
  }

  async function safeReleaseLock() {
    if (!session || zvolenyVysielac == null) return;
    const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
    try {
      try {
        await onDisconnect(lockRef).cancel();
      } catch {}
      await set(lockRef, null);
    } catch (e) {
      console.error("Chyba pri uvoľnení vysielača:", e);
    } finally {
      mamAktivnyLock.current = false;
      setZvolenyVysielac(null);
      setObjednavka({});
      sessionStorage.removeItem("zvolenyVysielac");
    }
  }

  async function switchToSession(targetCode) {
    if (!targetCode) return;
    if (Object.keys(objednavka || {}).length > 0 || zvolenyVysielac != null) {
      const ok = window.confirm(
        "Zmeniť session? Rozpracovaná objednávka a prípadný zámok vysielača budú zrušené."
      );
      if (!ok) return;
    }
    await safeReleaseLock();
    setShowSessionModal(false);
    await pripojitSa(targetCode);
  }

  async function createAndSwitch() {
    if (Object.keys(objednavka || {}).length > 0 || zvolenyVysielac != null) {
      const ok = window.confirm(
        "Vytvoriť novú session? Rozpracovaná objednávka a prípadný zámok vysielača budú zrušené."
      );
      if (!ok) return;
    }
    await safeReleaseLock();
    setShowSessionModal(false);
    setNovyKodLoading(true);
    try {
      await vytvorSession();
    } finally {
      setNovyKodLoading(false);
    }
  }

  async function signOutSession() {
    if (!session) return;
    if (Object.keys(objednavka || {}).length > 0 || zvolenyVysielac != null) {
      const ok = window.confirm(
        "Odhlásiť zo session? Rozpracovaná objednávka a prípadný zámok vysielača budú zrušené."
      );
      if (!ok) return;
    }
    await safeReleaseLock();
    setSession("");
    setPreset("");
    setMenu([]);
    sessionStorage.removeItem("session");
    sessionStorage.removeItem("preset");
    toast.info("Odhlásené zo session.");
  }

  async function vybratVysielac(cislo) {
    if (!session) return;
    const lockRef = ref(db, `sessions/${session}/vysielace/${cislo}`);
    try {
      const res = await runTransaction(
        lockRef,
        (current) => {
          if (current === true) {
            return;
          }
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
    await safeReleaseLock();
  }

  async function zrusitObjednavku() {
    if (Object.keys(objednavka).length === 0) {
      await safeReleaseLock();
      return;
    }
    const ok = window.confirm("Zrušiť rozpracovanú objednávku?");
    if (!ok) return;
    setObjednavka({});
    toast.info("Objednávka bola zrušená.");
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
        toast.warn("Nie ste v session.");
        return;
      }
      if (!zvolenyVysielac) {
        toast.warn("Najprv vyberte vysielač.");
        return;
      }
      if (Object.keys(objednavka).length === 0) {
        toast.info("Košík je prázdny.");
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

      const lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);

      try {
        await onDisconnect(lockRef).cancel();
      } catch (e) {
        console.warn("Nepodarilo sa cancelnúť onDisconnect locku:", e);
      }

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

  // ===== UI =====
  if (!session) {
    return (
      <div style={{ padding: 20, maxWidth: 420 }}>
        <h2>Pripojenie k akcii (session)</h2>

        <div style={{ margin: "16px 0" }}>
          <button className="k-btn" onClick={vytvorSession}>Vytvoriť novú session</button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="k-input"
            maxLength={4}
            value={kodInput}
            onChange={(e) => setKodInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="Zadajte existujúci kód (4 čísla)"
          />
          <button className="k-btn" onClick={() => pripojitSa(kodInput)}>Pripojiť sa</button>
        </div>
      </div>
    );
  }

  return (
    <div className="k-wrap">
      {/* TOP BAR */}
      <div className="k-top">
        <div className="k-row" style={{ justifyContent: "space-between" }}>
          <div className="k-row">
            <button className="k-btn" onClick={goToPresety}>Presety</button>
            {vsetkyPresety.length ? (
              <select className="k-select" value={preset} onChange={(e)=>zmenitPreset(e.target.value)}>
                <option value="">— Vyberte preset —</option>
                {vsetkyPresety.map(p=> <option key={p} value={p}>{p}</option>)}
              </select>
            ) : <span className="k-help">Žiadne presety</span>}
          </div>

          <div className="k-row">
            <button className="k-btn" onClick={() => setShowSessionModal(true)}>
              Session {session}
            </button>
          </div>
        </div>
      </div>

      {/* GRID: MENU + KOŠÍK */}
      <div className="k-grid">
        <div className="k-col">
          {/* PANEL VYSIELAČOV */}
          {!zvolenyVysielac && (
            <div className="k-panel">
              <h2 className="k-title">Zvoľte vysielač</h2>
              <div className="k-vysielace">
                {vysielaceCisla.map((cislo) => {
                  const locked = !!zablokovaneVysielace[cislo];
                  return (
                    <button
                      key={cislo}
                      className={`k-vys-btn ${locked ? "locked" : "free"}`}
                      disabled={locked}
                      onClick={() => vybratVysielac(cislo)}
                      title={locked ? "Zablokovaný" : "Voľný"}
                    >
                      {cislo}
                      {locked && <span className="k-flag">LOCK</span>}
                    </button>
                  );
                })}
              </div>
              <div className="k-help" style={{ marginTop: 8 }}>
                Najprv zvoľte vysielač. Potom sa zobrazí ponuka.
              </div>
            </div>
          )}

          {/* MENU GRID */}
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
                        <strong>{nazov}</strong> <span className="k-help">×{pocet}</span>
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

      {/* Session switcher modal */}
      {showSessionModal && (
        <div className="k-modal" role="dialog" aria-modal="true">
          <div className="k-backdrop" onClick={() => setShowSessionModal(false)} />
          <div className="k-sheet">
            <h3 style={{ marginTop: 0 }}>Prepnutie session</h3>

            <div className="k-row" style={{ marginTop: 10 }}>
              <input
                className="k-input"
                maxLength={4}
                value={kodInput}
                onChange={(e) => setKodInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="Zadajte kód (4 čísla)"
                style={{ width: 160 }}
              />
              <button className="k-btn" onClick={() => switchToSession(kodInput)}>Pripojiť</button>
              <button className="k-btn" onClick={createAndSwitch} disabled={novyKodLoading}>
                {novyKodLoading ? "Vytváram…" : "Vytvoriť novú a prepnúť"}
              </button>
              <span className="k-spacer" />
              <button className="k-btn" onClick={signOutSession}>Odhlásiť zo session</button>
              <button className="k-btn" onClick={() => setShowSessionModal(false)}>Zavrieť</button>
            </div>

            {recentSessions.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="k-help" style={{ marginBottom: 6 }}>Naposledy použité:</div>
                <div className="k-row" style={{ flexWrap: "wrap" }}>
                  {recentSessions.map((k) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button className="k-btn" onClick={() => switchToSession(k)}>Session {k}</button>
                      <button className="k-btn" onClick={() => forgetSession(k)} title="Odstrániť zo zoznamu">Odstrániť</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}