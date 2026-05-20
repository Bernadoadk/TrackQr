import React, { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "./Icon";

interface ToastData {
  id: string;
  title: string;
  desc?: string;
  type?: "success" | "error" | "warning" | "info";
  duration?: number;
}

interface ToastContextValue {
  push: (toast: Omit<ToastData, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const push = useCallback((toast: Omit<ToastData, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, ...toast }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), toast.duration ?? 3800);
  }, []);

  const iconForType = (type?: string) => {
    if (type === "error") return "x";
    if (type === "warning") return "bell";
    if (type === "info") return "bell";
    return "check";
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type ?? ""}`}>
            <div className="toast-icon"><Icon name={iconForType(t.type)} size={16} /></div>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.desc && <div className="toast-desc">{t.desc}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx.push;
}
