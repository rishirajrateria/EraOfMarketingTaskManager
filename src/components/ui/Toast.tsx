"use client";
import { createContext, useCallback, useContext, useState } from "react";

export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = { action?: ToastAction; ms?: number };
type Toast = { id: number; text: string; tone: "ok" | "err"; action?: ToastAction };
type Push = (text: string, tone?: "ok" | "err", opts?: ToastOptions) => void;
const Ctx = createContext<Push>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>(
    (text, tone = "ok", opts) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text, tone, action: opts?.action }]);
      setTimeout(() => dismiss(id), opts?.ms ?? 3500);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex max-w-[90%] items-center gap-3 rounded-[14px] px-4 py-2.5 text-center text-[13px] font-medium text-white ${t.tone === "ok" ? "toast-glass" : "bg-[#b91c1c] shadow-lg"} ${t.action ? "pointer-events-auto" : ""}`}
          >
            <span>{t.text}</span>
            {t.action ? (
              <button
                type="button"
                className="-my-1 shrink-0 rounded-lg px-2 py-1 text-[13px] font-bold uppercase tracking-wide text-[#7dd3fc] active:bg-white/10"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
