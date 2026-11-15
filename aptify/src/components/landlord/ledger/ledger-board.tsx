"use client";

import { useState } from "react";
import { RpcButton } from "@/components/landlord/rpc-button";
import { SiteButton } from "@/components/site-button";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import {
  methodLabel,
  monthTitle,
  receiptNo,
  statusBadge,
  statusRank,
  type LedgerData,
  type LedgerRow,
} from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { RecordCashDialog } from "./record-cash-dialog";
import { ReviewPaymentDialog } from "./review-payment-dialog";

type Tab = "all" | "pending" | "overdue";

const cols =
  "grid grid-cols-[minmax(150px,240px)_80px_110px_110px_150px_1fr] items-center gap-4";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-[32px] font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

export function LedgerBoard({
  data,
  propertyName,
}: {
  data: LedgerData;
  propertyName: string;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const month = monthTitle(data.month);
  const rows = [...data.rows].sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      a.unit_label.localeCompare(b.unit_label, undefined, { numeric: true })
  );

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const overdueCount = rows.filter((r) => r.status === "overdue").length;
  const shown = rows.filter((r) => tab === "all" || r.status === tab);

  // Looked up by id so the dialog always shows fresh data after a refresh
  const reviewing = rows.find((r) => r.bill_id === reviewingId && r.pending) ?? null;
  const cashRows = rows.filter((r) => Number(r.balance) > 0 && r.status !== "pending");
  const nextReceipt = receiptNo(data.next_receipt_year, data.next_receipt_number);

  const tabs: { value: Tab; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: `Pending (${pendingCount})` },
    { value: "overdue", label: `Overdue (${overdueCount})` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">Rent ledger</h1>
          <p className="text-[15px] text-slate-500">
            {month} · {propertyName}
          </p>
        </div>
        <Button type="button" onClick={() => setRecording(true)}>
          Record cash payment
        </Button>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Stat
          value={data.rent_received_pct === null ? "—" : `${data.rent_received_pct}%`}
          label="Rent received"
        />
        <Stat value={String(data.pending_count)} label="Pending payments" />
        <Stat value={String(data.open_repairs)} label="Open repairs" />
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tab === t.value}
              onClick={() => setTab(t.value)}
              className={`cursor-pointer rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold ${
                tab === t.value
                  ? "border-sky-700 bg-sky-700 text-white"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-lg font-bold text-slate-900">No bills for {month.split(" ")[0]} yet</p>
          <p className="text-sm text-slate-500">Bills appear here once you add a tenant to a unit.</p>
          <div className="mt-2">
            <SiteButton href="/landlord/units/invite">Add tenant</SiteButton>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <div className="min-w-[860px]">
            <div
              className={`${cols} border-b border-slate-200 px-6 py-3 text-xs font-semibold text-slate-500`}
            >
              <span>Tenant</span>
              <span>Unit</span>
              <span>Amount</span>
              <span>Method</span>
              <span>Status</span>
              <span>Actions</span>
            </div>

            {shown.length === 0 && (
              <p className="px-6 py-6 text-sm text-slate-500">Nothing in this list.</p>
            )}

            {shown.map((r) => {
              const b = statusBadge(r);
              return (
                <div
                  key={r.bill_id}
                  className={`${cols} border-b border-slate-100 px-6 py-3.5 text-sm last:border-b-0`}
                >
                  <span className="font-semibold text-slate-900">
                    {r.tenant_name}
                    {r.bill_type === "move_in" && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        Move-in
                      </span>
                    )}
                  </span>
                  <span className="text-slate-900">{shortLabel(r.unit_label)}</span>
                  <span className="text-slate-900">
                    {formatPeso(Number(r.amount)).replace(/\.00$/, "")}
                  </span>
                  <span className="text-slate-900">
                    {r.method ? (methodLabel[r.method] ?? r.method) : "None yet"}
                  </span>
                  <span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.cls}`}>
                      {b.text}
                    </span>
                  </span>
                  <span className="flex justify-end gap-2">
                    {r.status === "pending" && (
                      <Button type="button" onClick={() => setReviewingId(r.bill_id)}>
                        Review payment
                      </Button>
                    )}
                    {r.status === "overdue" && (
                      <RpcButton
                        label="Send reminder"
                        doneLabel="Sent"
                        rpc="send_rent_reminder"
                        args={{ p_bill: r.bill_id }}
                      />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reviewing && (
        <ReviewPaymentDialog row={reviewing as LedgerRow} onClose={() => setReviewingId(null)} />
      )}
      {recording && (
        <RecordCashDialog
          rows={cashRows}
          nextReceipt={nextReceipt}
          onClose={() => setRecording(false)}
        />
      )}
    </div>
  );
}
