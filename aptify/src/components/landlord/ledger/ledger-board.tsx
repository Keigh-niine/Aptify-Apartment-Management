"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { RpcButton } from "@/components/landlord/rpc-button";
import { SiteButton } from "@/components/site-button";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import {
  methodLabel,
  monthTitle,
  dateWithYear,
  receiptNo,
  receiptStatus,
  shortDate,
  statusBadge,
  statusRank,
  type LedgerData,
  type BillLedgerRow,
  type ReceiptRecord,
} from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { GenerateBillsButton } from "./generate-bills-button";
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

const receiptCols =
  "grid grid-cols-[140px_120px_minmax(150px,240px)_70px_90px_130px_1fr] items-center gap-4";

function ReceiptsTable({
  receipts,
  error,
}: {
  receipts: ReceiptRecord[];
  error: string | null;
}) {
  const [query, setQuery] = useState("");

  // Matches "OR-2026-0001", "2026-0001" or just "0001"
  const q = query.trim().toLowerCase();
  const shown = q ? receipts.filter((r) => r.receipt_no.toLowerCase().includes(q)) : receipts;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-slate-900">Receipts</h2>
          <p className="text-sm text-slate-500">
            Saved permanently. They stay even if a tenant is removed or deletes their account. They are only deleted if you delete your own account.
          </p>
        </div>
        {receipts.length > 0 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search receipt no. (e.g. OR-2026-0001)"
            aria-label="Search receipts by receipt number"
            className="w-full rounded-[10px] border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-700 focus:ring-2 focus:ring-sky-200 sm:w-[320px]"
          />
        )}
      </div>

      {error ? (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load receipts. Make sure you ran 014 and 016 in Supabase. ({error})
        </p>
      ) : receipts.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
          No receipts yet. One is saved each time a payment is confirmed.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
          No receipt matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <div className="min-w-[860px]">
            <div
              className={`${receiptCols} border-b border-slate-200 px-6 py-3 text-xs font-semibold text-slate-500`}
            >
              <span>Receipt no.</span>
              <span>Date paid</span>
              <span>Tenant</span>
              <span>Unit</span>
              <span>Method</span>
              <span>Status</span>
              <span className="text-right">Amount</span>
            </div>
            {shown.map((r) => {
              const s = receiptStatus[r.pay_status] ?? receiptStatus.fully_paid;
              return (
                <div
                  key={r.id}
                  className={`${receiptCols} border-b border-slate-100 px-6 py-3.5 text-sm last:border-b-0`}
                >
                  <span className="font-semibold text-slate-900">{r.receipt_no}</span>
                  <span className="text-slate-900">{dateWithYear(r.received_on)}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-slate-900">{r.tenant_name}</span>
                    {r.tenant_email && (
                      <span className="truncate text-xs text-slate-500">{r.tenant_email}</span>
                    )}
                  </span>
                  <span className="text-slate-900">{shortLabel(r.unit_label)}</span>
                  <span className="text-slate-900">{methodLabel[r.method] ?? r.method}</span>
                  <span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>
                      {s.text}
                    </span>
                  </span>
                  <span className="text-right font-semibold text-slate-900">
                    {formatPeso(Number(r.amount))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function LedgerBoard({
  data,
  propertyId,
  propertyName,
  receipts,
  receiptsError,
}: {
  data: LedgerData;
  propertyId: string;
  propertyName: string;
  receipts: ReceiptRecord[];
  receiptsError: string | null;
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

  const unbilledCount = rows.filter((r) => r.status === "unbilled" && !r.starts_on).length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const overdueCount = rows.filter((r) => r.status === "overdue").length;
  const shown = rows.filter((r) => tab === "all" || r.status === tab);

  // Looked up by id so the dialog always shows fresh data after a refresh
  const reviewing =
    rows.find(
      (r): r is BillLedgerRow => r.status !== "unbilled" && r.bill_id === reviewingId && !!r.pending
    ) ?? null;
  const cashRows = rows.filter(
    (r): r is BillLedgerRow =>
      r.status !== "unbilled" && Number(r.balance) > 0 && r.status !== "pending"
  );
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

      {unbilledCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">
              {unbilledCount} tenant{unbilledCount === 1 ? "" : "s"} not billed for {month}.
            </span>{" "}
            Generate their bills so they can see and pay them.
          </p>
          <GenerateBillsButton propertyId={propertyId} month={data.month} />
        </div>
      )}

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
          <p className="text-lg font-bold text-slate-900">No tenants yet</p>
          <p className="text-sm text-slate-500">Tenants appear here once they join a unit.</p>
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
                  key={r.bill_id ?? r.lease_id}
                  className={`${cols} border-b border-slate-100 px-6 py-3.5 text-sm last:border-b-0`}
                >
                  <span className="font-semibold text-slate-900">
                    {r.tenant_name}
                    {r.status !== "unbilled" && r.bill_type === "move_in" && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        Move-in
                      </span>
                    )}
                  </span>
                  <span className="text-slate-900">{shortLabel(r.unit_label)}</span>
                  <span className="text-slate-900">
                    {r.status === "unbilled"
                      ? "—"
                      : formatPeso(Number(r.amount)).replace(/\.00$/, "")}
                  </span>
                  <span className="text-slate-900">
                    {r.status === "unbilled"
                      ? "—"
                      : r.method
                        ? (methodLabel[r.method] ?? r.method)
                        : "None yet"}
                  </span>
                  <span className="flex flex-col items-start gap-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${b.cls}`}
                    >
                      {r.status === "paid" && <Check className="size-3.5" aria-hidden />}
                      {b.text}
                    </span>
                    {r.status === "paid" && r.paid_on && (
                      <span className="text-xs text-slate-500">on {shortDate(r.paid_on)}</span>
                    )}
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

      <ReceiptsTable receipts={receipts} error={receiptsError} />

      {reviewing && (
        <ReviewPaymentDialog row={reviewing} onClose={() => setReviewingId(null)} />
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