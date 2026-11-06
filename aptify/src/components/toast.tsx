"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Kind = "ok" | "info" | "err";
type Toast = { id: number; kind: Kind; message: string };

const ToastContext = createContext<{ toast: (kind: Kind, message: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}

const styles: Record<Kind, { box: string; icon: string; symbol: string }> = {
  ok: { box: "border-green-200 bg-green-50 text-green-900", icon: "bg-green-600", symbol: "✓" },
  info: { box: "border-sky-200 bg-sky-50 text-sky-900", icon: "bg-sky-700", symbol: "i" },
  err: { box: "border-red-200 bg-red-50 text-red-900", icon: "bg-red-600", symbol: "✕" },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const s = styles[toast.kind];

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role={toast.kind === "err" ? "alert" : "status"}
      className={`pointer-events-auto flex w-[min(420px,calc(100vw-2rem))] items-center gap-3 rounded-xl border px-4 py-[13px] shadow-lg transition-all duration-300 motion-reduce:transition-none ${s.box} ${
        shown ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      <span
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${s.icon}`}
        aria-hidden
      >
        {s.symbol}
      </span>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="cursor-pointer text-sm opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

// Short messages that appear for 4 seconds at the top right.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: Kind, message: string) => {
      const id = ++nextId.current;
      setItems((list) => [...list, { id, kind, message }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
