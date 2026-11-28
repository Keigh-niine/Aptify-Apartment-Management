"use client";

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { mailDate } from "@/lib/mail-date";
import { cap, statusChip, type RequestRow } from "@/lib/tenant-maintenance";

const PAGE_SIZE = 50;

export type MaintenanceMailRow = RequestRow & { description: string };
export type MaintenanceTab = "all" | "open" | "resolved";

// Same look as Mail: open requests are bold on white, resolved ones are grey like read mail
export function MaintenanceInbox({
  rows,
  initialTab = "all",
}: {
  rows: MaintenanceMailRow[];
  initialTab?: MaintenanceTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<MaintenanceTab>(initialTab);
  const [page, setPage] = useState(0);

  const open = rows.filter((r) => r.status !== "resolved");
  const resolved = rows.filter((r) => r.status === "resolved");
  const filtered = tab === "open" ? open : tab === "resolved" ? resolved : rows;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : current * PAGE_SIZE + 1;
  const to = current * PAGE_SIZE + shown.length;

  const tabs: { value: MaintenanceTab; label: string }[] = [
    { value: "all", label: `All (${rows.length})` },
    { value: "open", label: `Open (${open.length})` },
    { value: "resolved", label: `Resolved (${resolved.length})` },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={() => router.refresh()}
          aria-label="Refresh"
          title="Refresh"
          className="flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          <RefreshCw className="size-[18px]" aria-hidden />
        </button>

        <div role="tablist" aria-label="Request filter" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => {
                setTab(t.value);
                setPage(0);
              }}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                tab === t.value ? "bg-sky-100 text-sky-800" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 text-xs text-slate-600">
          <span className="mr-1">
            {from}–{to} of {filtered.length}
          </span>
          <button
            type="button"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="Newer"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
            aria-label="Older"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Rows */}
      {shown.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-500">Nothing in this list.</p>
      ) : (
        <ul>
          {shown.map((r) => {
            const chip = statusChip[r.status];
            const active = r.status !== "resolved";
            return (
              <li key={r.id} className="border-b border-slate-100 last:border-b-0">
                <Link
                  href={`/tenant/maintenance/${r.id}`}
                  className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left text-sm hover:shadow-[inset_1px_0_0_#cbd5e1,inset_-1px_0_0_#cbd5e1,0_1px_2px_rgba(15,23,42,0.15)] sm:flex-row sm:items-center sm:gap-4 ${
                    active ? "bg-white" : "bg-slate-50"
                  }`}
                >
                  <span
                    className={`truncate sm:w-[180px] sm:shrink-0 ${
                      active ? "font-bold text-slate-900" : "text-slate-700"
                    }`}
                  >
                    {cap(r.category)}
                  </span>

                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}
                    >
                      {chip.text}
                    </span>
                    {r.urgency === "urgent" && active && (
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                        Urgent
                      </span>
                    )}
                    <span className="min-w-0 truncate">
                      <span className={active ? "font-bold text-slate-900" : "text-slate-700"}>
                        {r.title}
                      </span>
                      {r.description && (
                        <span className="text-slate-500"> – {r.description.replace(/\s+/g, " ")}</span>
                      )}
                    </span>
                  </span>

                  <span
                    suppressHydrationWarning
                    className={`shrink-0 text-xs sm:w-[72px] sm:text-right ${
                      active ? "font-bold text-slate-900" : "text-slate-500"
                    }`}
                  >
                    {mailDate(r.created_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}