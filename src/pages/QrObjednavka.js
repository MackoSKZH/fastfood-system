import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { onValue, push, ref, runTransaction, set } from "firebase/database";
import { db } from "../firebase";
import { getClientId } from "../lib/clientId";
import { allocateOrderNumber, OrderNumbersFullError, releaseOrderNumber } from "../lib/orderNumber";
import { writeQrStav } from "../lib/qrStav";
import { renderReceipt } from "../lib/receiptCanvas";
import { printCanvasViaRawBT } from "../lib/rawbtPrint";
import { isWebSerialSupported, prepareWebSerialPort, printCanvasViaWebSerial, requestWebSerialPort } from "../lib/webSerialPrint";
import { customerCopy, foodLabel } from "../lib/qrCopy";
import { playChime, unlockChime } from "../lib/chime";
import { ITEM_COLORS } from "./Kasa";
import "./kiosk.css";
import "./qr.css";

const MAX_PORCII = 12;
const MAX_SUMA = 80;
const MAX_SIDE = 5;
const COOLDOWN_MS = 60_000;
const RECEIPT_TTL = 2 * 60 * 60 * 1000;
const KIOSK_PRINT_WIDTH = 576;
const KIOSK_RESET_MS = 20_000;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function langStorageKey(sessionCode) {
  return `qrLang:${sessionCode}`;
}

function readLang(sessionCode, isKiosk) {
  if (isKiosk || !sessionCode) return null;
  try {
    const value = localStorage.getItem(langStorageKey(sessionCode));
    return value === "en" || value === "sk" ? value : null;
  } catch {
    return null;
  }
}

function itemColor(farba) {
  if (farba != null && farba >= 0 && farba < ITEM_COLORS.length) return ITEM_COLORS[farba];
  return null;
}

function parseMenu(data) {
  return Object.entries(data || {}).filter(([, v]) => v?.qr !== false).map(([nazov, v]) => ({
    nazov,
    en: typeof v?.en === "string" ? v.en : "",
    cena: money((v && v.cena) ?? 0),
    farba: v?.farba != null ? Number(v.farba) : null,
    poradie: v?.poradie != null ? Number(v.poradie) : null,
    prilohy: Object.entries(v?.prilohy || {})
      .map(([pn, pv]) => ({
        nazov: pn,
        en: typeof pv?.en === "string" ? pv.en : "",
        cena: money(pv?.cena ?? 0),
        poradie: pv?.poradie != null ? Number(pv.poradie) : null,
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
  });
}

function cooldownKey(sessionCode) {
  return `qrLastOrder:${sessionCode}`;
}

function receiptKey(sessionCode) {
  return `qrReceipt:${sessionCode}`;
}

function readLastOrder(sessionCode) {
  const n = Number(localStorage.getItem(cooldownKey(sessionCode)) || 0);
  return Number.isFinite(n) ? n : 0;
}

function forgetReceipt(sessionCode) {
  if (!sessionCode) return;
  try {
    localStorage.removeItem(receiptKey(sessionCode));
    sessionStorage.removeItem(receiptKey(sessionCode));
  } catch {}
}

function readReceipt(sessionCode) {
  if (!sessionCode) return null;
  try {
    let raw = localStorage.getItem(receiptKey(sessionCode));
    if (!raw) {
      raw = sessionStorage.getItem(receiptKey(sessionCode));
      if (raw) localStorage.setItem(receiptKey(sessionCode), raw);
    }
    sessionStorage.removeItem(receiptKey(sessionCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.orderNumber || Date.now() - Number(parsed.timestamp || 0) > RECEIPT_TTL) {
      forgetReceipt(sessionCode);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildKioskReceipt(receipt, nazovPodniku) {
  const riadky = [];
  for (const line of receipt.lines || []) {
    const qty = Number(line.qty) || 0;
    const unit = Number.isFinite(Number(line.unit)) ? Number(line.unit) : (qty > 0 ? money(line.lineSum) / qty : 0);
    for (let i = 0; i < qty; i++) {
      riadky.push({
        nazov: line.nazov,
        cena: unit,
        prilohy: (line.sides || []).map((side) => ({
          nazov: side.nazov,
          cena: money(side.cena),
          count: side.count,
        })),
      });
    }
  }
  return {
    nazovPodniku,
    orderNumber: receipt.orderNumber,
    createdAt: receipt.timestamp,
    riadky,
    suma: receipt.suma,
  };
}

export default function QrObjednavka({ variant = "qr" }) {
  const isKiosk = variant === "kiosk";
  const params = useParams();
  const sessionCode = (params.sessionCode || "").trim();

  const savedReceipt = isKiosk ? null : readReceipt(sessionCode);
  const [sessionSeen, setSessionSeen] = useState(sessionCode);
  const [sessionState, setSessionState] = useState("loading");
  const [preset, setPreset] = useState("");
  const [menu, setMenu] = useState([]);
  const [menuState, setMenuState] = useState("idle");
  const [cart, setCart] = useState({});
  const [step, setStep] = useState(savedReceipt ? "hotovo" : "menu");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(savedReceipt);
  const [qrStav, setQrStav] = useState("kuchyna");
  const [lastOrderAt, setLastOrderAt] = useState(() => (isKiosk ? 0 : readLastOrder(sessionCode)));
  const [now, setNow] = useState(Date.now());
  const [printState, setPrintState] = useState("idle");
  const [printError, setPrintError] = useState("");
  const [printerReady, setPrinterReady] = useState(false);
  const [lang, setLang] = useState(() => readLang(sessionCode, isKiosk));
  const [kioskLocked, setKioskLocked] = useState(false);
  const sendingRef = useRef(false);
  const printedFor = useRef(null);
  const chimedFor = useRef("");
  const qrStavRef = useRef("kuchyna");
  const receiptRef = useRef(null);
  const tryReadyChimeRef = useRef(() => {});

  if (sessionSeen !== sessionCode) {
    const nextReceipt = isKiosk ? null : readReceipt(sessionCode);
    setSessionSeen(sessionCode);
    setReceipt(nextReceipt);
    setQrStav("kuchyna");
    setStep(nextReceipt ? "hotovo" : "menu");
    setCart({});
    setError("");
    setPrintState("idle");
    setPrintError("");
    setLang(readLang(sessionCode, isKiosk));
    setLastOrderAt(isKiosk ? 0 : readLastOrder(sessionCode));
    setSessionState("loading");
    setPreset("");
    setMenu([]);
    setMenuState("idle");
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  qrStavRef.current = qrStav;
  receiptRef.current = receipt;
  tryReadyChimeRef.current = () => {
    if (isKiosk || qrStavRef.current !== "hotove") return;
    const token = receiptRef.current?.orderId || String(receiptRef.current?.orderNumber || "");
    if (!token || chimedFor.current === token) return;
    if (playChime()) chimedFor.current = token;
  };

  useEffect(() => {
    tryReadyChimeRef.current();
  }, [isKiosk, qrStav, receipt?.orderId, receipt?.orderNumber]);

  useEffect(() => {
    if (isKiosk) return undefined;
    function onPointer() {
      unlockChime();
      tryReadyChimeRef.current();
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [isKiosk]);

  useEffect(() => {
    if (isKiosk || !sessionCode || !receipt?.orderId) {
      setQrStav("kuchyna");
      return undefined;
    }
    const off = onValue(ref(db, `sessions/${sessionCode}/qrStav/${receipt.orderId}`), (snap) => {
      const stav = snap.val()?.stav;
      if (stav === "kuchyna" || stav === "hotove" || stav === "prevzate") setQrStav(stav);
    });
    return () => off();
  }, [isKiosk, sessionCode, receipt?.orderId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  useEffect(() => {
    if (!isKiosk || !sessionCode) return undefined;
    const off = onValue(ref(db, `sessions/${sessionCode}/kioskLock`), (snap) => {
      const locked = snap.val() === true;
      setKioskLocked(locked);
      if (locked) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    });
    return () => off();
  }, [isKiosk, sessionCode]);

  useEffect(() => {
    if (!isKiosk || !kioskLocked) return undefined;
    function keepFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
    document.addEventListener("pointerdown", keepFullscreen);
    return () => document.removeEventListener("pointerdown", keepFullscreen);
  }, [isKiosk, kioskLocked]);

  useEffect(() => {
    if (!isKiosk) return undefined;
    let cancelled = false;
    prepareWebSerialPort()
      .then((ready) => { if (!cancelled) setPrinterReady(ready); })
      .catch(() => { if (!cancelled) setPrinterReady(false); });
    return () => { cancelled = true; };
  }, [isKiosk]);

  useEffect(() => {
    if (!isKiosk || step !== "hotovo" || !receipt) return undefined;
    const id = setTimeout(() => {
      setReceipt(null);
      setCart({});
      setError("");
      setPrintState("idle");
      setPrintError("");
      setLang(null);
      setStep("menu");
    }, KIOSK_RESET_MS);
    return () => clearTimeout(id);
  }, [isKiosk, step, receipt]);

  useEffect(() => {
    if (!isKiosk || step !== "hotovo" || !receipt?.orderNumber) return undefined;
    const token = receipt.timestamp;
    if (printedFor.current === token) return undefined;
    printedFor.current = token;
    let active = true;
    printKioskTicket(receipt, () => active);
    return () => {
      active = false;
      printedFor.current = null;
    };
    // Tlač sa spustí raz po uložení účtenky. Opakovaná tlač ide tlačidlom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKiosk, step, receipt]);

  useEffect(() => {
    if (!sessionCode || /[.#$[\]/]/.test(sessionCode)) {
      setSessionState("missing");
      return;
    }
    const off = onValue(
      ref(db, `sessions/${sessionCode}`),
      (snap) => {
        if (!snap.exists()) {
          setSessionState("missing");
          setPreset("");
          return;
        }
        setSessionState("ready");
        setPreset(snap.val()?.preset || "");
      },
      () => setSessionState("error")
    );
    return () => off();
  }, [sessionCode]);

  useEffect(() => {
    if (sessionState !== "ready") return;
    if (!preset) {
      setMenu([]);
      setMenuState("ready");
      return;
    }
    setMenuState("loading");
    const off = onValue(
      ref(db, `presets/${preset}`),
      (snap) => {
        setMenu(parseMenu(snap.val() || {}));
        setMenuState("ready");
      },
      () => {
        setMenu([]);
        setMenuState("ready");
      }
    );
    return () => off();
  }, [preset, sessionState]);

  const lines = useMemo(() => {
    const out = [];
    for (const item of menu) {
      const qty = Number(cart[item.nazov]?.qty) || 0;
      if (qty <= 0) continue;
      const chosen = [];
      let sideSum = 0;
      for (const p of item.prilohy) {
        const count = Math.min(MAX_SIDE, Number(cart[item.nazov]?.prilohy?.[p.nazov]) || 0);
        if (count <= 0) continue;
        chosen.push({
          nazov: p.nazov,
          label: foodLabel(lang || "sk", p.nazov, p.en),
          cena: p.cena,
          count,
          en: p.en,
        });
        sideSum += p.cena * count;
      }
      const unit = round2(item.cena + sideSum);
      out.push({
        nazov: item.nazov,
        en: item.en,
        label: foodLabel(lang || "sk", item.nazov, item.en),
        qty,
        sides: chosen,
        unit,
        lineSum: round2(unit * qty),
      });
    }
    return out;
  }, [menu, cart, lang]);

  const portions = lines.reduce((sum, line) => sum + line.qty, 0);
  const suma = round2(lines.reduce((sum, line) => sum + line.lineSum, 0));
  const cooldownLeft = isKiosk ? 0 : Math.max(0, COOLDOWN_MS - (now - lastOrderAt));

  const open = sessionState === "ready" && menuState === "ready" && !!preset && menu.length > 0;
  const loading = sessionState === "loading" || (sessionState === "ready" && !!preset && menuState === "loading");

  function setQty(nazov, qty) {
    setCart((prev) => {
      const others = Object.entries(prev).reduce(
        (sum, [name, line]) => sum + (name === nazov ? 0 : Number(line.qty) || 0),
        0
      );
      const nextQty = Math.max(0, Math.min(qty, MAX_PORCII - others));
      if (nextQty <= 0) {
        if (!prev[nazov]) return prev;
        const copy = { ...prev };
        delete copy[nazov];
        return copy;
      }
      return {
        ...prev,
        [nazov]: { qty: nextQty, prilohy: prev[nazov]?.prilohy || {} },
      };
    });
  }

  function setSide(nazov, priloha, count) {
    const next = Math.max(0, Math.min(MAX_SIDE, count));
    setCart((prev) => {
      const line = prev[nazov];
      if (!line?.qty) return prev;
      const prilohy = { ...(line.prilohy || {}) };
      if (next <= 0) delete prilohy[priloha];
      else prilohy[priloha] = next;
      return { ...prev, [nazov]: { ...line, prilohy } };
    });
  }

  function payBlockReason() {
    const text = customerCopy(lang || "sk");
    if (portions < 1) return text.needOne;
    if (portions > MAX_PORCII) return text.maxPortions;
    if (suma > MAX_SUMA) return text.maxSum;
    return "";
  }

  function novaObjednavka() {
    if (!isKiosk) forgetReceipt(sessionCode);
    setReceipt(null);
    setCart({});
    setError("");
    setPrintState("idle");
    setPrintError("");
    if (isKiosk) setLang(null);
    setStep("menu");
  }

  function chooseLang(next) {
    setLang(next);
    if (!isKiosk) localStorage.setItem(langStorageKey(sessionCode), next);
  }

  async function printKioskTicket(ticket, isActive = () => true) {
    if (!isActive()) return;
    setPrintState("printing");
    setPrintError("");
    try {
      const canvas = await renderReceipt(
        buildKioskReceipt(ticket, preset || sessionCode),
        { width: KIOSK_PRINT_WIDTH }
      );
      if (!isActive()) return;
      if (isWebSerialSupported()) {
        const ready = await prepareWebSerialPort();
        if (!isActive()) return;
        if (!ready) {
          setPrinterReady(false);
          setPrintState("failed");
          setPrintError(customerCopy(lang || "sk").connectFirst);
          return;
        }
        await printCanvasViaWebSerial(canvas, { cut: true });
        if (!isActive()) return;
        setPrinterReady(true);
      } else {
        printCanvasViaRawBT(canvas);
      }
      if (!isActive()) return;
      setPrintState("ok");
    } catch (err) {
      if (!isActive()) return;
      console.error("Kiosk tlač zlyhala:", err);
      setPrintState("failed");
      setPrintError(customerCopy(lang || "sk").printFailed);
    }
  }

  async function connectPrinter() {
    try {
      await requestWebSerialPort();
      setPrinterReady(true);
      setPrintError("");
    } catch (err) {
      if (err?.name === "NotFoundError") return;
      setPrintError(err?.message || "Tlačiareň sa nepodarilo pripojiť.");
    }
  }

  async function enterFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setPrintError("Celú obrazovku sa nepodarilo zapnúť.");
    }
  }

  async function odoslat() {
    if (!isKiosk) unlockChime();
    if (sendingRef.current) return;
    const reason = payBlockReason();
    if (reason || cooldownLeft > 0) {
      setError(reason || customerCopy(lang || "sk").cooldown(Math.ceil(cooldownLeft / 1000)));
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError("");
    const cooldownRef = ref(db, `sessions/${sessionCode}/qrCooldown/${getClientId()}`);
    let cooldownSet = false;
    let orderNumber = null;
    let saved = false;
    try {
      let stamped = Date.now();
      if (!isKiosk) {
        const cooldownRes = await runTransaction(cooldownRef, (current) => {
          const t = Date.now();
          if (typeof current === "number" && t - current < COOLDOWN_MS) return;
          return t;
        });
        if (!cooldownRes.committed) {
          const current = cooldownRes.snapshot?.val();
          if (typeof current === "number") {
            localStorage.setItem(cooldownKey(sessionCode), String(current));
            setLastOrderAt(current);
            const sec = Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - current)) / 1000));
            setError(customerCopy(lang || "sk").cooldown(sec));
          } else {
            setError(customerCopy(lang || "sk").sendFailed);
          }
          return;
        }
        cooldownSet = true;
        stamped = Number(cooldownRes.snapshot.val());
        if (!Number.isFinite(stamped)) throw new Error("cooldown");
      }

      const orderNumberIssued = await allocateOrderNumber(sessionCode);
      orderNumber = orderNumberIssued;

      const polozky = {};
      const prilohy = {};
      for (const line of lines) {
        polozky[line.nazov] = line.qty;
        if (!line.sides.length) continue;
        const sides = {};
        for (const side of line.sides) sides[side.nazov] = side.count;
        for (let idx = 0; idx < line.qty; idx++) {
          prilohy[`${line.nazov}||${idx}`] = { ...sides };
        }
      }

      const timestamp = Date.now();
      const newRef = push(ref(db, `sessions/${sessionCode}/objednavky`));
      await set(newRef, {
        zdroj: isKiosk ? "kiosk" : "qr",
        platba: "hotovost",
        orderNumber,
        polozky,
        ...(Object.keys(prilohy).length ? { prilohy } : {}),
        suma,
        status: "waiting",
        timestamp,
      });
      saved = true;
      if (!isKiosk) {
        try {
          await writeQrStav(sessionCode, newRef.key, "kuchyna", orderNumber);
        } catch (err) {
          console.error("Stav QR sa nepodarilo uložiť:", err);
        }
      }

      const snapshot = {
        orderId: newRef.key,
        orderNumber,
        suma,
        timestamp,
        lines: lines.map((line) => ({
          nazov: line.nazov,
          label: line.label,
          qty: line.qty,
          unit: line.unit,
          lineSum: line.lineSum,
          sides: line.sides.map((side) => ({
            nazov: side.nazov,
            label: side.label,
            count: side.count,
            cena: side.cena,
          })),
        })),
      };
      if (!isKiosk) {
        localStorage.setItem(receiptKey(sessionCode), JSON.stringify(snapshot));
        localStorage.setItem(cooldownKey(sessionCode), String(stamped));
        setLastOrderAt(stamped);
      }
      setReceipt(snapshot);
      setCart({});
      setStep("hotovo");
    } catch (err) {
      console.error("QR objednávka zlyhala:", err);
      if (!saved && typeof orderNumber === "number") {
        try { await releaseOrderNumber(sessionCode, orderNumber); } catch {}
      }
      if (cooldownSet) {
        try { await set(cooldownRef, null); } catch {}
      }
      setError(err instanceof OrderNumbersFullError
        ? customerCopy(lang || "sk").numbersFull
        : customerCopy(lang || "sk").sendFailed);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function kioskStaffBar() {
    if (!isKiosk || kioskLocked) return null;
    return (
      <div className="kiosk-tools">
        <button type="button" className="k-btn" onClick={connectPrinter} title={printerReady ? "Tlačiareň je pripravená" : "Vyber sériový port"}>
          Pripojiť tlačiareň
        </button>
        <button type="button" className="k-btn" onClick={enterFullscreen}>Celá obrazovka</button>
      </div>
    );
  }

  const copy = customerCopy(lang || "sk");
  const shell = isKiosk ? `qr-page is-kiosk${kioskLocked ? " is-locked" : ""}` : "qr-page";
  const hasStoredReceipt = !isKiosk && step === "hotovo" && receipt;

  if (!lang && !hasStoredReceipt) {
    return (
      <div className={shell}>
        <header className="qr-top">
          {kioskStaffBar()}
          <div className="qr-kicker">SK / EN</div>
          <h1>Slovenčina · English</h1>
          <p>Vyber jazyk · Choose a language</p>
        </header>
        <div className="qr-lang">
          <button type="button" className="k-btn primary" onClick={() => chooseLang("sk")}>Slovenčina</button>
          <button type="button" className="k-btn primary" onClick={() => chooseLang("en")}>English</button>
        </div>
      </div>
    );
  }

  if (isKiosk && step === "hotovo" && receipt) {
    return (
      <div className={`${shell} is-done`}>
        <header className="qr-top">
          {kioskStaffBar()}
          <div className="qr-kicker">Kiosk</div>
          <h1>{copy.takeTicket}</h1>
        </header>
        <div className="qr-number" aria-live="polite">#{receipt.orderNumber}</div>
        <p className="qr-lead">{copy.showNumberPay}</p>
        {printState === "printing" && <p className="qr-lead">{copy.printing}</p>}
        {printState === "failed" && (
          <div className="k-panel qr-done" style={{ marginBottom: 12 }}>
            <p className="qr-vydaj bad">{printError || copy.printFailed}</p>
            <button type="button" className="k-btn primary" onClick={() => printKioskTicket(receipt)}>
              {copy.printAgain}
            </button>
          </div>
        )}
        {printError && printState !== "failed" && <p className="qr-vydaj bad">{printError}</p>}
        <section className="k-panel qr-done">
          {(receipt.lines || []).map((line) => (
            <div key={line.nazov}>
              <div className="qr-line">
                <span>{line.qty}× {line.label || line.nazov}</span>
                <strong>€{money(line.lineSum).toFixed(2)}</strong>
              </div>
              {(line.sides || []).map((side) => (
                <div key={side.nazov} className="k-help" style={{ paddingLeft: 12 }}>
                  ↳ {side.count > 1 ? `${side.count}× ` : ""}{side.label || side.nazov} {copy.perPortion}
                </div>
              ))}
            </div>
          ))}
          <div className="qr-line">
            <span>{copy.total}</span>
            <strong>€{money(receipt.suma).toFixed(2)}</strong>
          </div>
          <button type="button" className="k-btn" onClick={novaObjednavka}>
            {copy.nextGuest}
          </button>
        </section>
      </div>
    );
  }

  if (step === "hotovo" && receipt) {
    const live = Boolean(receipt.orderId);
    const statusCopy = !live
      ? {
          kicker: copy.sent,
          title: copy.showAtPickup,
          lead: copy.payWhenPickup,
        }
      : qrStav === "hotove"
        ? {
            kicker: copy.ready,
            title: copy.readyTitle,
            lead: copy.readyLead,
            box: true,
          }
        : qrStav === "prevzate"
          ? { kicker: copy.picked, title: copy.enjoy, lead: "" }
          : {
              kicker: copy.preparing,
              title: copy.orderNo,
              lead: copy.comeWhenReady,
            };
    return (
      <div className={`qr-page is-done${live ? ` is-${qrStav}` : ""}`}>
        <header className="qr-top">
          {kioskStaffBar()}
          <div className="qr-kicker">{statusCopy.kicker}</div>
          {!statusCopy.box && <h1>{statusCopy.title}</h1>}
        </header>
        <div className="qr-number" aria-live="polite">QR #{receipt.orderNumber}</div>
        {statusCopy.box ? (
          <div className="qr-ready" role="status">
            <h1>{statusCopy.title}</h1>
            <p>{statusCopy.lead}</p>
          </div>
        ) : statusCopy.lead ? <p className="qr-lead">{statusCopy.lead}</p> : null}
        <section className="k-panel qr-done">
          {(receipt.lines || []).map((line) => (
            <div key={line.nazov}>
              <div className="qr-line">
                <span>{line.qty}× {line.label || line.nazov}</span>
                <strong>€{money(line.lineSum).toFixed(2)}</strong>
              </div>
              {(line.sides || []).map((side) => (
                <div key={side.nazov} className="k-help" style={{ paddingLeft: 12 }}>
                  ↳ {side.count > 1 ? `${side.count}× ` : ""}{side.label || side.nazov} {copy.perPortion}
                </div>
              ))}
            </div>
          ))}
          <div className="qr-line">
            <span>{copy.total}</span>
            <strong>€{money(receipt.suma).toFixed(2)}</strong>
          </div>
          <p className="qr-lead" style={{ marginTop: 8 }}>{copy.payWhenPickup}</p>
          <button type="button" className="k-btn" onClick={novaObjednavka}>
            {copy.newOrder}
          </button>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${shell} is-done`}>
        <header className="qr-top">
          {kioskStaffBar()}
          <div className="qr-kicker">{copy.order}</div>
          <h1>{copy.loading}</h1>
        </header>
      </div>
    );
  }

  if (sessionState === "missing" || !sessionCode) {
    return (
      <div className={`${shell} is-done`}>
        <header className="qr-top">
          {kioskStaffBar()}
          <div className="qr-kicker">{copy.order}</div>
          <h1>{copy.missingTitle}</h1>
          <p>{copy.missingLead}</p>
        </header>
      </div>
    );
  }

  if (sessionState === "error" || !open) {
    return (
      <div className={`${shell} is-done`}>
        <header className="qr-top">
          {kioskStaffBar()}
          <div className="qr-kicker">{copy.order}</div>
          <h1>{copy.closedTitle}</h1>
          <p>
            {sessionState === "error"
              ? copy.closedError
              : preset
                ? (isKiosk ? copy.closedEmptyKiosk : copy.closedEmptyQr)
                : copy.closedNoPreset}
          </p>
        </header>
      </div>
    );
  }

  const payReason = payBlockReason();
  const confirmBlocked = !!payReason || cooldownLeft > 0 || sending;
  const confirmReason = payReason || (cooldownLeft > 0
    ? copy.cooldown(Math.ceil(cooldownLeft / 1000))
    : "");

  return (
    <div className={shell}>
      <header className="qr-top">
          {kioskStaffBar()}
        <div className="qr-kicker">
          {step === "menu" ? copy.menu : copy.confirmStep}
        </div>
        <h1>{step === "menu" ? preset : copy.reviewTitle}</h1>
        <p>{copy.payLead}</p>
      </header>

      {step === "menu" && (
        <div className="k-menu qr-menu">
          {menu.map((item) => {
            const qty = Number(cart[item.nazov]?.qty) || 0;
            const col = itemColor(item.farba);
            const atCap = portions >= MAX_PORCII;
            return (
              <article
                key={item.nazov}
                className={`k-card${qty > 0 ? " in-cart" : ""}`}
                style={col ? { "--ic-bg": col.bg, "--ic-border": col.border, "--ic-btn": col.btn } : undefined}
              >
                <div className="name">{foodLabel(lang, item.nazov, item.en)}</div>
                <div className="price">€{item.cena.toFixed(2)}</div>
                <div className="actions">
                  {qty === 0 ? (
                    <button
                      type="button"
                      className="k-btn primary"
                      style={{ width: "100%" }}
                      disabled={portions >= MAX_PORCII}
                      onClick={() => setQty(item.nazov, 1)}
                    >
                      {copy.add}
                    </button>
                  ) : (
                    <div className="k-qty">
                      <button type="button" onClick={() => setQty(item.nazov, qty - 1)} aria-label={`${copy.less} ${foodLabel(lang, item.nazov, item.en)}`}>–</button>
                      <strong>{qty}</strong>
                      <button
                        type="button"
                        onClick={() => setQty(item.nazov, qty + 1)}
                        disabled={atCap}
                        aria-label={`${copy.more} ${foodLabel(lang, item.nazov, item.en)}`}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                {qty > 0 && item.prilohy.length > 0 && (
                  <div className="qr-card-sides">
                    <div className="k-help">{copy.sideNote}</div>
                    {item.prilohy.map((p) => {
                      const count = Math.min(MAX_SIDE, Number(cart[item.nazov]?.prilohy?.[p.nazov]) || 0);
                      return (
                        <div key={p.nazov} className="qr-side">
                          <span className="qr-side-name">
                            ↳ {foodLabel(lang, p.nazov, p.en)} <span className="k-help">€{p.cena.toFixed(2)}</span>
                          </span>
                          <span className="k-row" style={{ gap: 4 }}>
                            {count > 0 && (
                              <>
                                <button
                                  type="button"
                                  className="k-btn"
                                  style={{ minWidth: 44, padding: "6px 10px" }}
                                  onClick={() => setSide(item.nazov, p.nazov, count - 1)}
                                  aria-label={`${copy.less} ${foodLabel(lang, p.nazov, p.en)}`}
                                >
                                  –
                                </button>
                                <strong>{count}</strong>
                              </>
                            )}
                            <button
                              type="button"
                              className="k-btn"
                              style={{ minWidth: 44, padding: "6px 10px" }}
                              disabled={count >= MAX_SIDE}
                              onClick={() => setSide(item.nazov, p.nazov, count + 1)}
                              aria-label={`${copy.more} ${foodLabel(lang, p.nazov, p.en)}`}
                            >
                              +
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {step === "potvrdenie" && (
        <section className="k-panel qr-lines">
          {lines.map((line) => (
            <div key={line.nazov}>
              <div className="qr-line">
                <span>{line.qty}× {line.label || line.nazov}</span>
                <strong>€{line.lineSum.toFixed(2)}</strong>
              </div>
              {line.sides.map((side) => (
                <div key={side.nazov} className="k-help" style={{ paddingLeft: 12 }}>
                  ↳ {side.count > 1 ? `${side.count}× ` : ""}{side.label || side.nazov} {copy.perPortion}
                </div>
              ))}
            </div>
          ))}
          <div className="qr-line">
            <span>{copy.total}</span>
            <strong>€{suma.toFixed(2)}</strong>
          </div>
          <p style={{ margin: 0 }}>{copy.kitchenNote}</p>
        </section>
      )}

      <footer className="qr-footer">
        <div className="qr-footer-inner">
          {step === "menu" && (
            <>
              {portions >= MAX_PORCII && (
                <div className="k-help">{copy.maxPortions}</div>
              )}
              {suma > MAX_SUMA && (
                <div className="qr-hint bad">{copy.maxSum}</div>
              )}
              <div className="qr-footer-row">
                <div className="k-help">{portions} {copy.portion(portions)}</div>
                <div className="qr-total" aria-live="polite">€{suma.toFixed(2)}</div>
              </div>
              <button
                type="button"
                className="k-btn primary qr-go"
                disabled={portions < 1 || portions > MAX_PORCII || suma > MAX_SUMA}
                onClick={() => { setError(""); setStep("potvrdenie"); }}
              >
                {copy.review}
              </button>
            </>
          )}

          {step === "potvrdenie" && (
            <>
              {(error || confirmReason) && (
                <div className="qr-hint bad" aria-live="polite">{error || confirmReason}</div>
              )}
              <div className="qr-actions">
                <button type="button" className="k-btn" onClick={() => { setError(""); setStep("menu"); }} disabled={sending}>
                  {copy.back}
                </button>
                <button
                  type="button"
                  className="k-btn success"
                  disabled={confirmBlocked}
                  onClick={odoslat}
                >
                  {sending ? copy.sending : copy.send}
                </button>
              </div>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
