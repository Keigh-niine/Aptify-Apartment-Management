"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { formatPeso } from "@/lib/format";
import { methodLabel } from "@/lib/ledger";
import type { HistoryRow } from "@/lib/tenant-payments";

const BATCH = 8; // how many payments show at first, and how many more load each time

// "2026-11-12" -> "11/12/2026"
const slashDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};

// "2026-11-24T09:15:00+00:00" -> "11/24/2026" in Philippine time
const paidDate = (ts: string) =>
  slashDate(new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));

function statusChip(h: HistoryRow) {
  if (h.status === "confirmed") return { text: "Paid", cls: "bg-green-100 text-green-800" };
  if (h.status === "rejected") return { text: "Rejected", cls: "bg-red-100 text-red-800" };
  return { text: h.method === "cash" ? "Pending cash" : "Pending", cls: "bg-amber-100 text-amber-800" };
}

const outline =
  "inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50";

// A fixed-height table. It shows 8 payments; scroll to the bottom to load 8 more, and so on.
export function PaymentHistoryTable({ history }: { history: HistoryRow[] }) {
  const [count, setCount] = useState(BATCH);
  const busy = useRef(false);

  const shown = history.slice(0, count);
  const remaining = history.length - shown.length;

  // A new batch has arrived, so scrolling may load the next one again
  useEffect(() => {
    busy.current = false;
  }, [count]);

  function loadMore() {
    if (busy.current || remaining <= 0) return;
    busy.current = true;
    setCount((c) => c + BATCH);
  }

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) loadMore();
  }

  return (
    <div className="flex flex-col gap-2">
      <div onScroll={onScroll} className="h-[24rem] overflow-auto">
        <div className="min-w-[640px]">
          <div className="sticky top-0 z-10 grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500">
            <span>Date</span>
            <span>Amount</span>
            <span>Method</span>
            <span>Status</span>
            <span />
          </div>
          {shown.map((h) => {
            const c = statusChip(h);
            return (
              <div
                key={h.id}
                className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center gap-4 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0"
              >
                <span className="font-semibold text-slate-900">{paidDate(h.created_at)}</span>
                <span className="text-slate-900">{formatPeso(Number(h.amount))}</span>
                <span className="text-slate-900">{methodLabel[h.method]}</span>
                <span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${c.cls}`}>
                    {c.text}
                  </span>
                </span>
                <span className="flex justify-end">
                  {h.status === "confirmed" && h.receipt_no && (
                    <Link href={`/tenant/payments/receipts/${h.id}`} className={outline}>
                      View receipt
                    </Link>
                  )}
                </span>
              </div>
            );
          })}
          {remaining > 0 && (
            <div className="flex justify-center py-3">
              <button type="button" onClick={loadMore} className={outline}>
                Load {Math.min(BATCH, remaining)} more
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Showing {shown.length} of {history.length} payment{history.length === 1 ? "" : "s"}
        {remaining > 0 ? ". Scroll down to see more." : "."}
      </p>
    </div>
  );
}