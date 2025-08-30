import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./kiosk.css";

export default function Index() {
    const navigate = useNavigate();
    const [lastSession, setLastSession] = useState("");

    useEffect(() => {
        const s = sessionStorage.getItem("session");
        if (s) setLastSession(s);
    }, []);

    function clearLastSession() {
        sessionStorage.removeItem("session");
        sessionStorage.removeItem("preset");
        sessionStorage.removeItem("zvolenyVysielac");
        setLastSession("");
    }

    return (
        <div className="k-wrap">
        <header className="home-hero">
            <h1 className="home-title">Rýchla obsluha objednávok</h1>
            <p className="home-subtitle">
            Vyberte rolu. Obsluha spravuje objednávky a vysielače, Kuchyňa vybavuje pripravenie.
            </p>
        </header>

        {lastSession && (
            <section className="k-panel home-continue">
            <div className="home-continue-row">
                <div>
                <div className="k-help">Naposledy používaná session</div>
                <div className="home-session">Session <code>{lastSession}</code></div>
                </div>
                <div className="home-continue-actions">
                <button className="k-btn primary" onClick={() => navigate("/obsluha")}>
                    Pokračovať v obsluhe
                </button>
                <button className="k-btn" onClick={clearLastSession} title="Odstrániť z pamäte">
                    Odstrániť zo zoznamu
                </button>
                </div>
            </div>
            </section>
        )}

        <section className="home-roles">
            <article className="home-card">
            <h2>Obsluha</h2>
            <p className="k-help">
                Vytváranie objednávok, výber vysielača, potvrdenie a odovzdanie zákazníkovi.
            </p>
            <div className="home-card-footer">
                <button className="k-btn primary" onClick={() => navigate("/obsluha")}>
                Otvoriť obsluhu
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
        </section>

        <footer className="home-footer">
            <div className="k-help">© {new Date().getFullYear()} Martin Hronský</div>
        </footer>
        </div>
    );
}
