import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "./SessionProvider";
import "./pages/kiosk.css";

let db, ref, get, set, serverTimestamp;
try {
    ({ db } = require("./firebase"));
    ({ ref, get, set, serverTimestamp } = require("firebase/database"));
} catch (e) {}

export default function SessionSelect() {
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const navigate = useNavigate();
    const { login } = useSession();

    function normalize(input) {
        return input.replace(/\s/g, "");
    }

    function navigateAfterLogin() {
        // 1) ak si SessionGate uložil návratovú cestu, použijeme ju
        const back = sessionStorage.getItem("postLoginPath");
        if (back) {
        sessionStorage.removeItem("postLoginPath");
        navigate(back, { replace: true });
        return;
        }
        // 2) inak podľa role
        const r = localStorage.getItem("activeRole");
        navigate(
        r === "obsluha" ? "/obsluha" : r === "kuchyna" ? "/kuchyna" : "/kasa",
        { replace: true }
        );
    }

    async function loginExisting() {
        const c = normalize(code).trim();
        if (c.length < 3) return setErr("Zadaj platný kód (min. 3 znaky).");
        setErr(""); setBusy(true);
        try {
        if (db && get && ref) {
            const snap = await get(ref(db, `sessions/${c}`));
            if (!snap.exists()) {
            setErr("Session s týmto kódom neexistuje."); setBusy(false);
            return;
            }
        }
        login(c);
        navigateAfterLogin();
        } catch (e) {
        console.error(e);
        setErr("Nepodarilo sa overiť session. Skús znova.");
        setBusy(false);
        }
    }

    async function createNew() {
        const c = normalize(code).trim();
        if (c.length < 3) return setErr("Zadaj platný kód (min. 3 znaky).");
        if (!db || !ref || !get || !set) {
        setErr("Na vytvorenie novej session potrebujem pripojenie k databáze.");
        return;
        }
        setErr(""); setBusy(true);
        try {
        const sessionRef = ref(db, `sessions/${c}`);
        const snap = await get(sessionRef);
        if (snap.exists()) {
            setErr("Session už existuje. Stlač „Pokračovať“ pre prihlásenie.");
            setBusy(false);
            return;
        }
        // minimálny základ štruktúry; uprav si podľa potreby
        await set(sessionRef, {
            createdAt: Date.now(), // alebo serverTimestamp?.()
            preset: "",            // voliteľné
            objednavky: null,
            vysielace: null,
            log: null,
        });

        login(c);
        navigateAfterLogin();
        } catch (e) {
        console.error(e);
        setErr("Vytvorenie session zlyhalo. Skús znova.");
        setBusy(false);
        }
    }

    return (
        <div className="k-wrap" style={{ maxWidth: 520, marginTop: 80 }}>
        <h1>Vyber alebo vytvor session</h1>
        <p className="k-help">
            Zadaj kód prevádzky/session. Môžeš sa buď prihlásiť do existujúcej, alebo vytvoriť novú s týmto kódom.
        </p>

        <div className="k-row" style={{ marginTop: 12 }}>
            <input
            className="k-input"
            placeholder="Kód session"
            value={code}
            onChange={(e)=>setCode(e.target.value)}
            onKeyDown={(e)=>e.key==="Enter" && loginExisting()}
            autoFocus
            />
        </div>

        <div className="k-row" style={{ marginTop: 10 }}>
            <button className="k-btn" onClick={loginExisting} disabled={busy}>
            {busy ? "Pracujem..." : "Pokračovať"}
            </button>
            <button
            className="k-btn"
            onClick={createNew}
            disabled={busy}
            title="Vytvorí novú session s týmto kódom"
            >
            {busy ? "Pracujem..." : "Vytvoriť session"}
            </button>
        </div>

        {err && <p className="k-error" style={{ marginTop: 8 }}>{err}</p>}
        </div>
    );
}
