import { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import {
  ref,
  set,
  push,
  update,
  onValue,
  runTransaction,
  onDisconnect,
} from "firebase/database";
import { useNavigate } from "react-router-dom";
import InfoModal from "../components/InfoModal";
import HistoryModal from "../components/HistoryModal";

import "./kiosk.css";
import RoleHeader from "./RoleHeader";
import { useSession } from "../SessionProvider";
import { useToast } from "../ui/toast";
import { renderReceipt, saveCanvasPngSilently } from "../lib/receiptCanvas";
import { printCanvasViaRawBT } from "../lib/rawbtPrint";
import { isWebSerialSupported, printCanvasViaWebSerial } from "../lib/webSerialPrint";
import { getClientId } from "../lib/clientId";
import { hasPager, isQrOrder, isTicketOrder, orderHeadline, QrVydaj } from "../lib/orderLabel";
import { allocateOrderNumber, OrderNumbersFullError, releaseOrderNumber } from "../lib/orderNumber";
import { writeQrStav } from "../lib/qrStav";
import { playChime, unlockChime } from "../lib/chime";
import QrLinkModal from "../components/QrLinkModal";

const VIP_VYSIELACE = ["01", "02", "03", "04"];
const VYDEJ_BANKOVKY = [100, 50, 20, 10, 5];
const VYDEJ_MINCE = [2, 1, 0.5, 0.2, 0.1, 0.05];

function formatMinca(value) {
  return value >= 1 ? `${value}€` : `${Math.round(value * 100)}c`;
}

function VydejHotovost({ suma, zaplatene, busy, onAdd, onReset, onConfirm }) {
  const ciel = Number(suma) || 0;
  const vydaj = Math.round((zaplatene - ciel) * 100) / 100;
  const ok = zaplatene + 0.001 >= ciel;
  return (
    <div className="k-vydej">
      <div className="k-row" style={{ flexWrap: "wrap", gap: 4 }}>
        {VYDEJ_BANKOVKY.map((note) => (
          <button key={note} type="button" className="k-btn" onClick={() => onAdd(note)}>{note}€</button>
        ))}
      </div>
      <div className="k-row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
        {VYDEJ_MINCE.map((coin) => (
          <button key={coin} type="button" className="k-btn" onClick={() => onAdd(coin)}>{formatMinca(coin)}</button>
        ))}
        <button type="button" className="k-btn" onClick={onReset}>Reset</button>
      </div>
      <div className="k-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="k-help">Zaplatené: <strong>€{zaplatene.toFixed(2)}</strong></span>
        <strong style={{ color: ok ? "#16a34a" : "#dc2626" }}>
          {ok ? `Vydať: €${vydaj.toFixed(2)}` : `Chýba: €${Math.abs(vydaj).toFixed(2)}`}
        </strong>
      </div>
      <button type="button" className="k-btn success" style={{ marginTop: 8, width: "100%" }} disabled={!ok || busy} onClick={onConfirm}>
        Odovzdať
      </button>
    </div>
  );
}

export const ITEM_COLORS = [
  { bg: '#FEF3C7', border: '#F59E0B', btn: '#D97706' },
  { bg: '#DBEAFE', border: '#60A5FA', btn: '#2563EB' },
  { bg: '#D1FAE5', border: '#34D399', btn: '#059669' },
  { bg: '#FCE7F3', border: '#F472B6', btn: '#DB2777' },
  { bg: '#EDE9FE', border: '#A78BFA', btn: '#7C3AED' },
  { bg: '#FEE2E2', border: '#FCA5A5', btn: '#DC2626' },
  { bg: '#CCFBF1', border: '#2DD4BF', btn: '#0F766E' },
  { bg: '#FFEDD5', border: '#FB923C', btn: '#EA580C' },
  { bg: '#E0F2FE', border: '#38BDF8', btn: '#0284C7' },
  { bg: '#F3E8FF', border: '#C084FC', btn: '#9333EA' },
  { bg: '#DCFCE7', border: '#4ADE80', btn: '#16A34A' },
  { bg: '#FEF9C3', border: '#FDE047', btn: '#CA8A04' },
  { bg: '#ECFCCB', border: '#A3E635', btn: '#65A30D' },
  { bg: '#CFFAFE', border: '#22D3EE', btn: '#0E7490' },
  { bg: '#FAE8FF', border: '#E879F9', btn: '#A21CAF' },
  { bg: '#FFE4E6', border: '#FB7185', btn: '#BE123C' },
  { bg: '#E0E7FF', border: '#818CF8', btn: '#4338CA' },
  { bg: '#F1F5F9', border: '#94A3B8', btn: '#334155' },
  { bg: '#F3E8D9', border: '#B08968', btn: '#6B4226' },
  { bg: '#F4F4D8', border: '#C4C46A', btn: '#6B6B1F' },
  { bg: '#F5D6D9', border: '#C2536B', btn: '#7A1F30' },
  { bg: '#DCEEFB', border: '#60A5C7', btn: '#1D4E71' },
  { bg: '#E5E7EB', border: '#6B7280', btn: '#1F2937' },
  { bg: '#FFE8E1', border: '#FF8A65', btn: '#D84315' },
];

function itemColorFn(farba) {
  if (farba != null && farba >= 0 && farba < ITEM_COLORS.length) return ITEM_COLORS[farba];
  return null;
}

export default function Kasa() {
  const navigate = useNavigate();
  const { sessionCode: session } = useSession();
  const toast = useToast();
  const myClientId = getClientId();

  const [preset, setPreset] = useState("");
  const [vsetkyPresety, setVsetkyPresety] = useState([]);
  const [menu, setMenu] = useState([]);
  const [zablokovaneVysielace, setZablokovaneVysielace] = useState({});
  const [zvolenyVysielac, setZvolenyVysielac] = useState(null);
  // Each entry: { id: string, nazov: string, prilohy: { [prilohaName]: count } }
  const [cartItems, setCartItems] = useState([]);
  const [showInfo, setShowInfo] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [logZaznamy, setLogZaznamy] = useState([]);
  const [logSession, setLogSession] = useState("");
  const [prevzateMap, setPrevzateMap] = useState({});
  const [prevzateSession, setPrevzateSession] = useState("");
  const [rieseneMap, setRieseneMap] = useState({});
  const [now, setNow] = useState(Date.now());
  const [zaplatene, setZaplatene] = useState(0);
  const [vydejId, setVydejId] = useState(null);
  const [vydejSuma, setVydejSuma] = useState(0);
  const [vydejBusy, setVydejBusy] = useState(false);
  const [kioskLocked, setKioskLocked] = useState(false);
  const [poslednyBlok, setPoslednyBlok] = useState(null);
  const [tlacim, setTlacim] = useState(false);
  const stiahnutyBlokIdRef = useRef(null);

  const mamAktivnyLock = useRef(false);
  const skipAutoUnlockOnce = useRef(false);
  const pravyPanelRef = useRef(null);
  const primedSession = useRef("");
  const seenReady = useRef(new Set());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Pravý panel (objednávka + kalkulačka) je "prilepený" pri scrollovaní menu –
  // top offset sa dopočíta podľa reálnej výšky sticky hlavičiek nad ním, aby ich neprekrýval.
  useEffect(() => {
    function nastavOffset() {
      if (!pravyPanelRef.current) return;
      const header = document.querySelector(".role-header");
      const top = document.querySelector(".k-top");
      const vyska = (header?.offsetHeight || 0) + (top?.offsetHeight || 0) + 12;
      pravyPanelRef.current.style.top = `${vyska}px`;
    }
    nastavOffset();
    window.addEventListener("resize", nastavOffset);
    return () => window.removeEventListener("resize", nastavOffset);
  }, []);

  useEffect(() => {
    const off = onValue(ref(db, "presets"), (snap) => {
      setVsetkyPresety(Object.keys(snap.val() || {}));
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const off = onValue(ref(db, `sessions/${session}/kioskLock`), (snap) => {
      setKioskLocked(snap.val() === true);
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}`), (snap) => {
      const data = snap.val();
      if (data?.preset) setPreset(data.preset);
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    setLogSession("");
    if (!session) return undefined;
    const off = onValue(ref(db, `sessions/${session}/log`), (s) => {
      const val = s.val() || {};
      const arr = Object.entries(val)
        .map(([id, rec]) => ({ id, ...rec }))
        .sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0));
      setLogZaznamy(arr);
      setLogSession(session);
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    setPrevzateSession("");
    if (!session) return undefined;
    const off = onValue(ref(db, `sessions/${session}/prevzate`), (s) => {
      setPrevzateMap(s.val() || {});
      setPrevzateSession(session);
    });
    return () => off();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const off = onValue(ref(db, `sessions/${session}/riesene`), (s) => {
      setRieseneMap(s.val() || {});
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
        farba: (v?.farba != null) ? Number(v.farba) : null,
        qr: v?.qr !== false,
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
      })).sort((a, b) => {
        const pa = a.poradie ?? Infinity;
        const pb = b.poradie ?? Infinity;
        if (pa !== pb) return pa - pb;
        return a.nazov.localeCompare(b.nazov, "sk");
      }));
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

  function otvoritVydej(rec) {
    setVydejId(rec.id);
    setVydejSuma(0);
  }

  async function dokocitVydej(rec) {
    if (!session || vydejBusy) return;
    const suma = Number(rec.suma) || 0;
    if (vydejSuma + 0.001 < suma) return;
    const vydaj = Math.round((vydejSuma - suma) * 100) / 100;
    setVydejBusy(true);
    try {
      await update(ref(db), {
        [`sessions/${session}/log/${rec.id}/zaplatene`]: vydejSuma,
        [`sessions/${session}/log/${rec.id}/vydaj`]: vydaj,
      });
      await oznacitPrevzate(
        rec.id,
        hasPager(rec) ? rec.vysielac : null,
        rec.orderNumber,
        isQrOrder(rec) ? rec.objednavkaId : null
      );
      setVydejId(null);
      setVydejSuma(0);
    } catch (err) {
      console.error("Hotovosť pri výdaji sa nepodarilo uložiť:", err);
      alert("Hotovosť sa nepodarilo uložiť.");
    } finally {
      setVydejBusy(false);
    }
  }

  function tlacidloOdovzdat(rec) {
    if (!isTicketOrder(rec)) {
      return (
        <button
          type="button"
          className="k-btn success"
          style={{ width: "100%" }}
          onClick={() => oznacitPrevzate(rec.id, hasPager(rec) ? rec.vysielac : null, rec.orderNumber, isQrOrder(rec) ? rec.objednavkaId : null)}
        >
          Odovzdať
        </button>
      );
    }
    if (vydejId !== rec.id) {
      return (
        <button type="button" className="k-btn success" style={{ width: "100%" }} onClick={() => otvoritVydej(rec)}>
          Odovzdať
        </button>
      );
    }
    return (
      <VydejHotovost
        suma={rec.suma}
        zaplatene={vydejSuma}
        busy={vydejBusy}
        onAdd={(amount) => setVydejSuma((prev) => Math.round((prev + amount) * 100) / 100)}
        onReset={() => setVydejSuma(0)}
        onConfirm={() => dokocitVydej(rec)}
      />
    );
  }

  async function prepnoutKiosk() {
    if (!session) return;
    try {
      await set(ref(db, `sessions/${session}/kioskLock`), !kioskLocked);
    } catch (err) {
      console.error("Zámok kiosku sa nepodarilo uložiť:", err);
      alert("Kiosk sa nepodarilo prepnúť.");
    }
  }

  async function oznacitPrevzate(id, vys = null, orderNumber = null, qrOrderId = null) {
    if (!session) return;
    await set(ref(db, `sessions/${session}/prevzate/${id}`), true);
    await set(ref(db, `sessions/${session}/riesene/${id}`), null);
    if (vys != null) {
      await set(ref(db, `sessions/${session}/vysielace/${vys}`), null);
    }
    if (qrOrderId) {
      try {
        await writeQrStav(session, qrOrderId, "prevzate", orderNumber);
      } catch (err) {
        console.error("Stav QR sa nepodarilo uložiť:", err);
      }
    }
    try {
      await releaseOrderNumber(session, orderNumber);
    } catch (err) {
      console.error("Číslo objednávky sa nepodarilo uvoľniť:", err);
    }
  }

  function rieseneStav(id) {
    const vlastnik = rieseneMap[id];
    if (!vlastnik) return "free";
    if (vlastnik === myClientId) return "mine";
    return "busy";
  }

  function rieseneTitle(id) {
    const stav = rieseneStav(id);
    if (stav === "free") return "Nikto to nerieši – klikni, ak to preberáš";
    if (stav === "mine") return "Ty to riešiš – klikni pre zrušenie";
    return "Rieši niekto iný";
  }

  async function toggleRiesene(id) {
    if (!session) return;
    const stav = rieseneStav(id);
    if (stav === "busy") {
      toast.warn("Túto objednávku už rieši niekto iný.");
      return;
    }
    if (stav === "free") {
      const uzNiecoNesiem = Object.entries(rieseneMap).some(([oid, vlastnik]) => oid !== id && vlastnik === myClientId);
      if (uzNiecoNesiem) {
        toast.warn("Najprv odovzdaj alebo odznač objednávku, ktorú už nesieš.");
        return;
      }
    }
    await set(ref(db, `sessions/${session}/riesene/${id}`), stav === "mine" ? null : myClientId);
  }

  async function tlacObjednavky(receiptObj) {
    if (!receiptObj) return;
    setTlacim(true);
    try {
      const canvas = await renderReceipt(receiptObj);
      if (stiahnutyBlokIdRef.current !== receiptObj.createdAt) {
        stiahnutyBlokIdRef.current = receiptObj.createdAt;
        saveCanvasPngSilently(canvas, `blocek-${receiptObj.orderNumber}-${receiptObj.createdAt}.png`).catch(() => {});
      }
      let vytlacenePriamo = false;
      if (isWebSerialSupported()) {
        try {
          await printCanvasViaWebSerial(canvas);
          toast.success("Bloček vytlačený (sériový port).");
          vytlacenePriamo = true;
        } catch (serialErr) {
          // Web Serial je na Androide ešte len experimentálny/nespoľahlivý – tichý fallback na RawBT.
          console.warn("Web Serial tlač zlyhala, skúšam RawBT:", serialErr);
        }
      }
      if (!vytlacenePriamo) {
        printCanvasViaRawBT(canvas);
        toast.success("Bloček odoslaný do RawBT na tlač.");
      }
    } catch (err) {
      console.error("Chyba pri tlači bločku:", err);
      toast.error(err?.message || "Tlač zlyhala.");
    } finally {
      setTlacim(false);
    }
  }

  async function vytlacitBlok() {
    await tlacObjednavky(poslednyBlok);
  }

  // Znovupostaví objekt pre tlačiareň zo záznamu v histórii (sessions/{session}/log).
  // Cena položiek/príloh sa dopočítava z aktuálneho presetu – ak sa ceny odvtedy zmenili,
  // reprint ukáže aktuálne ceny, nie tie z momentu objednania.
  function buildReceiptFromLog(rec) {
    const pol = rec?.polozky || {};
    const prilohyMap = rec?.prilohy || {};
    const riadky = [];
    Object.entries(pol).forEach(([nazov, pocet]) => {
      const menuItem = menu.find((m) => m.nazov === nazov);
      const cena = menuItem?.cena || 0;
      for (let idx = 0; idx < Number(pocet || 0); idx++) {
        const instancePrilohy = prilohyMap[`${nazov}||${idx}`] || {};
        const prilohy = Object.entries(instancePrilohy).map(([pnazov, count]) => {
          const pr = menuItem?.prilohy?.find((p) => p.nazov === pnazov);
          return { nazov: pnazov, cena: pr?.cena || 0, count };
        });
        riadky.push({ nazov, cena, prilohy });
      }
    });
    return {
      nazovPodniku: preset || session,
      orderNumber: rec.orderNumber,
      vysielac: rec.vysielac,
      riadky,
      suma: Number(rec?.suma || 0),
      // zaplatené/vydané sa v histórii neukladá (počítalo sa len naživo pri kase) – vynechá sa na bločku
      createdAt: rec.createdAt || rec.completedAt || Date.now(),
    };
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
    let lockRef = null;
    let orderNumber = null;
    let orderSaved = false;
    let numberStaysBusy = false;
    try {
      if (!session || !zvolenyVysielac || cartItems.length === 0) return;

      lockRef = ref(db, `sessions/${session}/vysielace/${zvolenyVysielac}`);
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

      orderNumber = await allocateOrderNumber(session);
      const issuedNumber = orderNumber;

      if (isExpress) {
        // Expresná objednávka – vydá sa rovno na kase, nejde do kuchyne ani do obsluhy
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
        orderSaved = true;
        await set(ref(db, `sessions/${session}/prevzate/${newLog.key}`), true);
        try { await releaseOrderNumber(session, issuedNumber); } catch (err) {
          console.error("Číslo objednávky sa nepodarilo uvoľniť:", err);
        }
        orderNumber = null;
        try { await onDisconnect(lockRef).cancel(); } catch {}
        await set(lockRef, null);
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
        orderSaved = true;
        numberStaysBusy = true;
        try { await onDisconnect(lockRef).cancel(); } catch {}
        await set(lockRef, true);
        mamAktivnyLock.current = true;
      }

      const suma = spocitajCenu();
      const riadkyBloku = cartItems.map((item) => {
        const pol = menu.find((m) => m.nazov === item.nazov);
        const prilohyBloku = Object.entries(item.prilohy).map(([pnazov, count]) => {
          const pr = pol?.prilohy?.find((p) => p.nazov === pnazov);
          return { nazov: pnazov, cena: pr?.cena || 0, count };
        });
        return { nazov: item.nazov, cena: pol?.cena || 0, prilohy: prilohyBloku };
      });
      setPoslednyBlok({
        nazovPodniku: preset || session,
        orderNumber: issuedNumber,
        vysielac: zvolenyVysielac,
        riadky: riadkyBloku,
        suma,
        zaplatene,
        vydaj: Math.round((zaplatene - suma) * 100) / 100,
        createdAt: now,
      });

      skipAutoUnlockOnce.current = true;
      setCartItems([]);
      setZvolenyVysielac(null);
      setZaplatene(0);
    } catch (err) {
      console.error("Chyba pri potvrdení objednávky:", err);
      if (orderNumber != null && !orderSaved) {
        try { await releaseOrderNumber(session, orderNumber); } catch {}
      }
      if (lockRef && mamAktivnyLock.current && !numberStaysBusy) {
        try { await onDisconnect(lockRef).cancel(); } catch {}
        try { await set(lockRef, null); } catch {}
        mamAktivnyLock.current = false;
      }
      if (err instanceof OrderNumbersFullError) {
        alert("Všetkých 100 čísel je ešte v kuchyni alebo na výdaji.");
      }
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
  const nevydaneKey = nevydane.map((z) => z.id).join("\n");
  const listsReady = Boolean(session) && logSession === session && prevzateSession === session;

  useEffect(() => {
    function onPointer() { unlockChime(); }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  useEffect(() => {
    if (!listsReady) return;
    const ids = nevydaneKey ? nevydaneKey.split("\n") : [];
    if (primedSession.current !== session) {
      primedSession.current = session;
      seenReady.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => id && !seenReady.current.has(id));
    seenReady.current = new Set(ids);
    fresh.forEach((_, i) => {
      window.setTimeout(() => playChime({ loud: true }), i * 320);
    });
  }, [listsReady, session, nevydaneKey]);

  if (!session) return null;

  return (
    <>
      <RoleHeader />
      <div className="k-wrap">
        <div className="k-top">
          <div className="k-row" style={{ justifyContent: "space-between" }}>
            <div className="k-row">
              <button className="btn" onClick={() => setShowInfo(true)}>Info</button>
              <button className="k-btn" onClick={() => setShowHistory(true)}>História</button>
              <button className="k-btn" onClick={() => setShowQr(true)}>QR objednávka</button>
              <button className={`k-btn${kioskLocked ? " success" : ""}`} onClick={prepnoutKiosk}>
                {kioskLocked ? "Odomknúť kiosk" : "Zamknúť kiosk"}
              </button>
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
        {showQr && <QrLinkModal session={session} onClose={() => setShowQr(false)} />}
        {showHistory && (
          <HistoryModal
            session={session}
            logZaznamy={logZaznamy}
            tlacim={tlacim}
            onPrint={(rec) => tlacObjednavky(buildReceiptFromLog(rec))}
            onClose={() => setShowHistory(false)}
          />
        )}

        <div className="k-grid">
          <div className="k-col">
            <div className="k-panel">
              <div className="k-menu">
                {menu.length === 0 && <i>Menu je prázdne.</i>}
                {menu.map((p) => {
                  const count = cartItems.filter((x) => x.nazov === p.nazov).length;
                  const col = itemColorFn(p.farba);
                  return (
                    <div
                      className={`k-card${count > 0 ? " in-cart" : ""}${p.qr ? " has-qr" : ""}`}
                      key={p.nazov}
                      style={col ? { '--ic-bg': col.bg, '--ic-border': col.border, '--ic-btn': col.btn } : undefined}
                    >
                      {p.qr && <span className="k-qr-mark" title="Aj na QR kóde">QR</span>}
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

          <div
            ref={pravyPanelRef}
            className="k-order-sidebar"
            style={{ display: "flex", flexDirection: "column", gap: 12, alignSelf: "start" }}
          >
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
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

              {poslednyBlok && (
                <div className="k-row" style={{ marginTop: 10 }}>
                  <button className="k-btn" disabled={tlacim} onClick={vytlacitBlok}>
                    {tlacim ? "Tlačím…" : "🖨️ Vytlačiť bloček"}
                  </button>
                  <span className="k-help">
                    Objednávka #{poslednyBlok.orderNumber} · Pípač #{poslednyBlok.vysielac}
                  </span>
                </div>
              )}
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
                              <div>
                                <span
                                  className={`status-dot status-dot--${rieseneStav(rec.id)}`}
                                  title={rieseneTitle(rec.id)}
                                  onClick={() => toggleRiesene(rec.id)}
                                />
                                <span style={{ fontWeight: 900, fontSize: "1.15em" }}>{orderHeadline(rec)}</span>
                              </div>
                              {!isTicketOrder(rec) && (
                                <div style={{ fontSize: "0.82em", color: "#6b7280" }}>Objednávka #{rec.orderNumber ?? "—"}</div>
                              )}
                              <QrVydaj order={rec} />
                              <div>{items || "—"}{prilohy && <span className="k-help"> · ↳ {prilohy}</span>}</div>
                            </td>
                            <td>{typeof rec.suma === "number" ? rec.suma.toFixed(2) + " €" : rec.suma || "—"}</td>
                            <td>{tlacidloOdovzdat(rec)}</td>
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
                            <div className="o-id">
                              <span
                                className={`status-dot status-dot--${rieseneStav(rec.id)}`}
                                title={rieseneTitle(rec.id)}
                                onClick={() => toggleRiesene(rec.id)}
                              />
                              {orderHeadline(rec)}
                            </div>
                            {!isTicketOrder(rec) && (
                              <div style={{ fontSize: "0.8em", color: "#6b7280", marginTop: 1 }}>Objednávka #{rec.orderNumber ?? "—"}</div>
                            )}
                            <QrVydaj order={rec} />
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
                        {tlacidloOdovzdat(rec)}
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
