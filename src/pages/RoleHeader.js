import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../SessionProvider";
import "./kiosk.css";

const ROLES = [
  { id: "obsluha", label: "Obsluha", path: "./obsluha" },
  { id: "kasa",    label: "Kasa",    path: "./kasa" },
  { id: "kuchyna", label: "Kuchyňa", path: "./kuchyna" },
];

export default function RoleHeader() {
  const location = useLocation();
  const navigate  = useNavigate();
  const { sessionCode, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const active = useMemo(() => {
    const found = ROLES.find(r => location.pathname.startsWith(r.path));
    return found?.id ?? null;
  }, [location.pathname]);

  useEffect(() => {
    if (active) localStorage.setItem("activeRole", active);
  }, [active]);

  function handleLogout() {
    logout();
    setMenuOpen(false);
    navigate("/session", { replace: true });
  }

  useEffect(() => {
    if (menuOpen) {
      const onKey = (e)=> e.key==="Escape" && setMenuOpen(false);
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  return (
    <header className="role-header">
      <div className="role-header__brand">fastfood-system</div>

      {/* Desktop */}
      <nav className="role-header__nav hide-on-mobile">
        {ROLES.map(r => (
          <NavLink
            key={r.id}
            to={r.path}
            className={({isActive}) => `role-tab ${isActive ? "is-active" : ""}`}
            onClick={() => localStorage.setItem("activeRole", r.id)}
          >
            {r.label}
          </NavLink>
        ))}
      </nav>

      <div className="role-header__session hide-on-mobile">
        <span className="role-badge">Session: <b>{sessionCode}</b></span>
        <button type="button" className="role-logout" onClick={handleLogout}>
          Odhlásiť
        </button>
      </div>

      {/* Mobile hamburger */}
      <button
        type="button"
        className={`hamburger show-on-mobile ${menuOpen ? "is-open" : ""}`}
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        onClick={() => setMenuOpen(v => !v)}
      >
        <span /><span /><span />
      </button>

      {/* Mobile menu */}
      {menuOpen && (
        <>
          <div
            id="mobile-menu"
            className="mobile-menu show-on-mobile open"
            role="menu"
            aria-hidden={false}
          >
            <div className="mobile-menu__section">
              {ROLES.map(r => (
                <NavLink
                  key={r.id}
                  to={r.path}
                  className={({isActive}) => `mobile-item ${isActive ? "is-active" : ""}`}
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => localStorage.setItem("activeRole", r.id)}
                >
                  {r.label}
                </NavLink>
              ))}
            </div>
            <div className="mobile-menu__section">
              <div className="mobile-session">Session: <b>{sessionCode}</b></div>
              <button
                type="button"
                className="mobile-logout"
                onClick={handleLogout}
              >
                Odhlásiť
              </button>
            </div>
          </div>
          <div
            className="mobile-backdrop show-on-mobile"
            onClick={() => setMenuOpen(false)}
          />
        </>
      )}
    </header>
  );
}
