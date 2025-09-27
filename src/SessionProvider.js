import { createContext, useContext, useEffect, useMemo, useState } from "react";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
    const [sessionCode, setSessionCode] = useState(() => {
        return localStorage.getItem("sessionCode") || "";
    });

    useEffect(() => {
        if (sessionCode) localStorage.setItem("sessionCode", sessionCode);
        else localStorage.removeItem("sessionCode");
    }, [sessionCode]);

    const value = useMemo(() => ({
        sessionCode,
        login: (code) => setSessionCode(code),
        logout: () => setSessionCode(""),
    }), [sessionCode]);

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
    const ctx = useContext(SessionContext);
    if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
    return ctx;
}
