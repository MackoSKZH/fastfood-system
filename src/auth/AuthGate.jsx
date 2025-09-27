import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase";

const AuthCtx = createContext({ user: null, signOut: () => {} });
export function useAuth() { return useContext(AuthCtx); }

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRedirectResult(auth).catch((e) => {
      console.error("getRedirectResult error:", e?.code, e?.message);
    });
  }, []);

  useEffect(() => {
    const off = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return () => off();
  }, []);

  async function signInGoogle() {
    const provider = new GoogleAuthProvider();

    try { await setPersistence(auth, browserLocalPersistence); }
    catch { await setPersistence(auth, inMemoryPersistence); }

    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Popup sign-in failed:", err?.code, err?.message);

      if (
        /initial state/i.test(err?.message || "") ||
        err?.code === "auth/popup-blocked" ||
        err?.code === "auth/operation-not-supported-in-this-environment"
      ) {
        await signInWithRedirect(auth, provider);
        return;
      }

      alert(`Prihlásenie zlyhalo: ${err?.code || "unknown"}`);
    }
  }

  async function signOutNow() {
    try { await signOut(auth); }
    catch (err) { console.error("Sign-out zlyhal:", err); }
  }

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div style={{ padding: 16, border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
          Načítavam…
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#F8FAFC" }}>
        <div style={{ width: 360, maxWidth: "92vw", padding: 20, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, boxShadow: "0 6px 18px rgba(0,0,0,.06)" }}>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Prihlásenie</h1>
          <p style={{ color: "#6B7280", marginTop: 0 }}>Pokračuj prihlásením cez Google účet.</p>
          <button onClick={signInGoogle} className="k-btn primary" style={{ width: "100%" }}>
            Prihlásiť sa cez Google
          </button>
          <p className="k-help" style={{ marginTop: 8 }}>
            Prihlásenie je nutné na prístup k pokladni, kuchyni a obsluhe.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ user, signOut: signOutNow }}>
      <div>
        <div
          style={{
            position: "fixed", right: 12, bottom: 12, zIndex: 300,
            display: "flex", gap: 8, alignItems: "center",
            background: "#fff", border: "1px solid #E5E7EB",
            borderRadius: 999, padding: "6px 10px",
            boxShadow: "0 6px 18px rgba(0,0,0,.08)",
          }}
        >
          <img
            src={
              (user && user.photoURL) ||
              "https://ui-avatars.com/api/?name=" +
                encodeURIComponent((user && (user.displayName || user.email)) || "U")
            }
            alt="Avatar"
            referrerPolicy="no-referrer"
            style={{ width: 24, height: 24, borderRadius: "50%" }}
          />
          <span style={{ fontSize: 13, color: "#374151", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.displayName || user.email}
          </span>
          <button className="k-btn" onClick={signOutNow} title="Odhlásiť sa">
            Odhlásiť
          </button>
        </div>
        {children}
      </div>
    </AuthCtx.Provider>
  );
}
