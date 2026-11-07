"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col gap-3 rounded-2xl bg-white p-7 shadow-xl"
      >
        <h2 id="dialog-title" className="text-xl font-bold text-slate-900">
          {title}
        </h2>
        <p className="text-sm leading-[22px] text-slate-500">{body}</p>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" autoFocus onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-red-600 px-5 py-[11px] text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
