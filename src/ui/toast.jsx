import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const idRef = useRef(1);

    const remove = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const push = useCallback((t) => {
        const id = idRef.current++;
        const toast = { id, variant: "info", title: "", message: "", duration: 4000, ...t };
        setToasts((prev) => [...prev, toast]);
        return id;
    }, []);

    const api = useMemo(() => ({
        show: push,
        info: (message, opts = {}) => push({ variant: "info", message, ...opts }),
        success: (message, opts = {}) => push({ variant: "success", message, ...opts }),
        error: (message, opts = {}) => push({ variant: "error", message, ...opts }),
        warn: (message, opts = {}) => push({ variant: "warn", message, ...opts }),
        remove,
        clear: () => setToasts([]),
    }), [push, remove]);

    return (
        <ToastCtx.Provider value={api}>
        {children}
        <div className="k-toast-container">
            {toasts.map((t) => (
            <Toast key={t.id} {...t} onClose={() => remove(t.id)} />
            ))}
        </div>
        </ToastCtx.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastCtx);
    if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
    return ctx;
}

function Toast({ variant, title, message, duration = 4000, onClose }) {
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        if (duration === 0) return;
        const id = setTimeout(() => setLeaving(true), duration);
        return () => clearTimeout(id);
    }, [duration]);

    useEffect(() => {
        if (!leaving) return;
        const id = setTimeout(() => onClose?.(), 180);
        return () => clearTimeout(id);
    }, [leaving, onClose]);

    return (
        <div className={`k-toast ${variant} ${leaving ? "hide" : ""}`}>
        <div className="k-toast-content">
            {title ? <div className="k-toast-title">{title}</div> : null}
            {message ? <div className="k-toast-msg">{message}</div> : null}
        </div>
        <button className="k-toast-x" onClick={() => setLeaving(true)} aria-label="Zavrieť">
            ×
        </button>
        {duration > 0 && (
            <div className="k-toast-progress" style={{ animationDuration: `${duration}ms` }} />
        )}
        </div>
    );
}

/* Voliteľný banner (inline do stránky) */
export function Banner({ variant = "info", title, children, onClose }) {
    return (
        <div className={`k-banner ${variant}`}>
        <div className="k-banner-content">
            {title ? <div className="k-banner-title">{title}</div> : null}
            <div className="k-banner-msg">{children}</div>
        </div>
        {onClose && (
            <button className="k-banner-x" onClick={onClose} aria-label="Zavrieť">
            ×
            </button>
        )}
        </div>
    );
}
