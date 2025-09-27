import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./kiosk.css";

export default function Index() {
    const navigate = useNavigate();
    const [lastSession, setLastSession] = useState("");

    useEffect(() => {
        const r = localStorage.getItem("activeRole");
        if (r === "obsluha") navigate("/obsluha", { replace: true });
        if (r === "kasa") navigate("/kasa", { replace: true });
        if (r === "kuchyna") navigate("/kuchyna", { replace: true });
    }, [navigate]);

    
    useEffect(() => {
        const s = localStorage.getItem("sessionCode");
        if (s) setLastSession(s);
    }, []);

    function clearLastSession() {
        localStorage.removeItem("sessionCode");
        localStorage.removeItem("preset");
        localStorage.removeItem("zvolenyVysielac");
        setLastSession("");
    }

    return (
        <div className="k-wrap">
        <header className="home-hero">
            <h1 className="home-title">Rýchla pokladňa objednávok</h1>
            <p className="home-subtitle">
            Vyberte rolu. Pokladňa spravuje objednávky a vysielače, Kuchyňa vybavuje pripravenie.
            </p>
        </header>

        {lastSession && (
            <section className="k-panel home-continue">
            <div className="home-continue-row">
                <div>
                <div className="k-help">Naposledy používaná session</div>
                <div className="home-session">
                    Session <code>{lastSession}</code>
                </div>
                </div>
                <div className="home-continue-actions">
                <button className="k-btn primary" onClick={() => navigate("/kasa")}>
                    Pokračovať ku kase
                </button>
                <button
                    className="k-btn"
                    onClick={clearLastSession}
                    title="Odstrániť z pamäte"
                >
                    Odstrániť zo zoznamu
                </button>
                </div>
            </div>
            </section>
        )}

        <section className="home-roles">
            <article className="home-card">
            <h2>Kasa</h2>
            <p className="k-help">
                Vytváranie objednávok, výber vysielača, potvrdenie a odovzdanie zákazníkovi.
            </p>
            <div className="home-card-footer">
                <button className="k-btn primary" onClick={() => navigate("/kasa")}>
                Otvoriť kasu
                </button>
            </div>
            </article>

            <article className="home-card">
            <h2>Kuchyňa</h2>
            <p className="k-help">
                Zobrazenie najstarších objednávok, označenie položiek a dokončenie objednávky.
            </p>
            <div className="home-card-footer">
                <button className="k-btn accent" onClick={() => navigate("/kuchyna")}>
                Otvoriť kuchyňu
                </button>
            </div>
            </article>

            <article className="home-card">
            <h2>Obsluha (výdaj)</h2>
            <p className="k-help">Prehľad objednávok označených kuchyňou ako HOTOVO.</p>
            <div className="home-card-footer">
                <button className="k-btn" onClick={() => navigate("/obsluha")}>
                Otvoriť obsluhu
                </button>
            </div>
            </article>
        </section>

        <footer className="home-footer">
            <div className="k-help">© {new Date().getFullYear()} Martin Hronský</div>
        </footer>
        </div>
    );
}
