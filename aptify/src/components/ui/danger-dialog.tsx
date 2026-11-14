"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// A confirmation for things that cannot be undone. The red button stays
// disabled until the person types the confirmation word.
export function DangerDialog({
  title,
  intro,
  items,
  note,
  confirmWord = "DELETE",
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  intro: string;
  items: string[];
  note?: string;
  confirmWord?: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ready = typed.trim() === confirmWord;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => !busy && onCancel()}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="danger-title"
        aria-describedby="danger-intro"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onConfirm();
        }}
        className="flex max-h-[90vh] w-full max-w-[480px] flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-7 shadow-xl"
      >
        <h2 id="danger-title" className="text-xl font-bold text-slate-900">
          {title}
        </h2>
        <p id="danger-intro" className="text-sm leading-[22px] text-slate-500">
          {intro}
        </p>

        <div className="rounded-xl bg-red-50 p-4">
          <p className="mb-1.5 text-[13px] font-semibold text-red-800">This permanently deletes:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-red-800">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        {note && <p className="text-xs leading-[18px] text-slate-500">{note}</p>}

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">
            Type <span className="font-bold">{confirmWord}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
            className="w-full rounded-[10px] border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-red-600 focus:ring-2 focus:ring-red-100"
          />
        </label>

        <div className="mt-1 flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-red-600 px-5 py-[11px] text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
