"use client";

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { mailDate } from "@/lib/mail-date";
import {
  categoryLabel,
  urgencyBadge,
  urgencyRank,
  type MStatus,
  type RequestView,
  type Technician,
} from "@/lib/maintenance";
import { TicketDetail } from "./ticket-detail";
import { TicketDialog } from "./ticket-dialog";

const PAGE_SIZE = 50;

const tabs: { value: MStatus; label: string }[] = [
  { value: "new", label: "Requests" },
  { value: "assigned", label: "Assigned" },
  { value: "resolved", label: "Resolved" },
];

const emptyText: Record<MStatus, string> = {
  new: "No requests waiting. Nice and quiet.",
  assigned: "Nothing is assigned right now.",
  resolved: "No resolved requests in the last 90 days.",
};

export function MaintenanceBoard({
  requests,
  technicians,
  userId,
  initialRequestId,
}: {
  requests: RequestView[];
  technicians: Technician[];
  userId: string;
  initialRequestId?: string;
}) {
  const router = useRouter();
  const initial = requests.find((r) => r.id === initialRequestId);
  const [tab, setTab] = useState<MStatus>(initial?.status ?? "new");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);

  // The overlay shows times in the viewer's timezone, so it is drawn in the browser only.
  // This avoids a server/browser mismatch when a request is opened from the link.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const count = (s: MStatus) => requests.filter((r) => r.status === s).length;

  const list = requests
    .filter((r) => r.status === tab)
    .sort((a, b) =>
      tab === "resolved"
        ? (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at)
        : urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.created_at.localeCompare(b.created_at)
    );

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = list.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const from = list.length === 0 ? 0 : current * PAGE_SIZE + 1;
  const to = current * PAGE_SIZE + shown.length;

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  return (
    <>
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

          <div role="tablist" aria-label="Request status" className="flex gap-1">
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
                {t.value === "resolved" ? "" : ` (${count(t.value)})`}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1 text-xs text-slate-600">
            <span className="mr-1">
              {from}–{to} of {list.length}
            </span>
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              aria-label="Previous page"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              aria-label="Next page"
              className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Rows: new requests are bold on white, like unread mail */}
        {shown.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">{emptyText[tab]}</p>
        ) : (
          <ul>
            {shown.map((r) => {
              const badge = urgencyBadge[r.urgency];
              const isNew = r.status === "new";
              const date = r.status === "resolved" ? (r.resolved_at ?? r.created_at) : r.created_at;
              return (
                <li key={r.id} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full cursor-pointer flex-col gap-0.5 px-4 py-3 text-left text-sm hover:shadow-[inset_1px_0_0_#cbd5e1,inset_-1px_0_0_#cbd5e1,0_1px_2px_rgba(15,23,42,0.15)] sm:flex-row sm:items-center sm:gap-4 ${
                      isNew ? "bg-white" : "bg-slate-50"
                    }`}
                  >
                    <span
                      className={`truncate sm:w-[220px] sm:shrink-0 ${
                        isNew ? "font-bold text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {r.unit_label}
                      {r.requester_name ? ` · ${r.requester_name}` : ""}
                    </span>

                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                      >
                        {badge.text}
                      </span>
                      <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 md:inline">
                        {categoryLabel(r.category)}
                      </span>
                      {r.status === "assigned" && r.technician_name && (
                        <span className="hidden shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 md:inline">
                          {r.technician_name}
                        </span>
                      )}
                      <span className="min-w-0 truncate">
                        <span className={isNew ? "font-bold text-slate-900" : "text-slate-700"}>
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
                        isNew ? "font-bold text-slate-900" : "text-slate-500"
                      }`}
                    >
                      {mailDate(date)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* The next step opens as an overlay */}
      {selected && mounted && (
        <TicketDialog labelledBy="ticket-title" onClose={() => setSelectedId(null)}>
          <TicketDetail
            key={selected.id}
            req={selected}
            technicians={technicians}
            userId={userId}
            onClose={() => setSelectedId(null)}
            onSaved={(status) => {
              setTab(status); // the list shows where the request went
              setPage(0);
              setSelectedId(null);
            }}
          />
        </TicketDialog>
      )}
    </>
  );
}