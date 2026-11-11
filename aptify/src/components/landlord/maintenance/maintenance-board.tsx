"use client";

import { useState, useSyncExternalStore } from "react";
import {
  categoryLabel,
  urgencyBadge,
  urgencyRank,
  type MStatus,
  type RequestView,
  type Technician,
} from "@/lib/maintenance";
import { TicketDetail } from "./ticket-detail";

const tabs: { value: MStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "assigned", label: "Assigned" },
  { value: "resolved", label: "Resolved" },
];

const emptyText: Record<MStatus, string> = {
  new: "No new requests. Nice and quiet.",
  assigned: "Nothing is assigned right now.",
  resolved: "No resolved requests in the last 90 days.",
};

export function MaintenanceBoard({
  requests,
  technicians,
  userId,
  propertyId,
  initialRequestId,
}: {
  requests: RequestView[];
  technicians: Technician[];
  userId: string;
  propertyId: string;
  initialRequestId?: string;
}) {
  const initial = requests.find((r) => r.id === initialRequestId);
  const [tab, setTab] = useState<MStatus>(initial?.status ?? "new");
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);

  // Dates and times are shown in the viewer's timezone, so the detail panel is
  // drawn in the browser only. This avoids a server/browser mismatch.
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

  const selected = list.find((r) => r.id === selectedId) ?? list[0] ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = tab === t.value;
          const n = t.value === "resolved" ? null : count(t.value);
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.value)}
              className={`cursor-pointer rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold ${
                active
                  ? "border-sky-700 bg-sky-700 text-white"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {t.label}
              {n !== null ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_460px]">
        {/* Ticket queue */}
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          {list.length === 0 && <p className="p-4 text-sm text-slate-500">{emptyText[tab]}</p>}
          {list.map((r) => {
            const badge = urgencyBadge[r.urgency];
            const active = selected?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setSelectedId(r.id)}
                className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                  active
                    ? "border-sky-700 bg-sky-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-slate-900">
                    {r.unit_label} · {categoryLabel(r.category)}
                  </span>
                  <span className="truncate text-[13px] text-slate-500">{r.title}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                >
                  {badge.text}
                </span>
              </button>
            );
          })}
        </div>

        {/* Ticket detail */}
        {selected ? (
          mounted ? (
            <TicketDetail
              key={selected.id}
              req={selected}
              technicians={technicians}
              userId={userId}
              propertyId={propertyId}
              onSaved={(status) => {
                setSelectedId(selected.id);
                setTab(status);
              }}
            />
          ) : (
            <div className="h-64 rounded-2xl border border-slate-200 bg-white" />
          )
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            Select a request to see its details.
          </div>
        )}
      </div>
    </div>
  );
}
