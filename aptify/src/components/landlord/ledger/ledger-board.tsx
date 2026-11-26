"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { RpcButton } from "@/components/landlord/rpc-button";
import { SiteButton } from "@/components/site-button";
import { Button } from "@/components/ui/button";
import { formatPeso, formatPesoCompact } from "@/lib/format";
import {
  methodLabel,
  numericDate,
  monthTitle,
  receiptNo,
  receiptStatus,
  shortDate,
  statusBadge,
  statusRank,
  type LedgerData,
  type Method,
  type BillLedgerRow,
  type ReceiptRecord,
  type UnpaidBill,
  daysOverdue,
  unpaidToRow,
} from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { RecordCashDialog } from "./record-cash-dialog";
import { ReviewPaymentDialog } from "./review-payment-dialog";

type Tab = "all" | "pending" | "overdue";

function Stat({
  value,
  label,
  note,
  title,
}: {
  value: string;
  label: string;
  note?: string;
  title?: string; // the full, exact value, shown when hovering
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-5">
      <p title={title} className="break-words text-[32px] font-bold leading-tight text-slate-900">
        {value}
      </p>
      <p className="text-sm text-slate-500">{label}</p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

const peso = formatPesoCompact; // short form for large amounts, like ₱2.47B

const HISTORY_BATCH = 8; // payments shown at first, and loaded each time you reach the bottom

const receiptCols =
  "grid grid-cols-[140px_120px_minmax(150px,240px)_70px_90px_130px_1fr] items-center gap-4";

type PayStatus = ReceiptRecord["pay_status"];

const methodOptions = (Object.keys(methodLabel) as Method[]).map((value) => ({
  value,
  label: methodLabel[value],
}));
const statusOptions = (Object.keys(receiptStatus) as PayStatus[]).map((value) => ({
  value,
  label: receiptStatus[value].text,
}));

const controlCls =
  "rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-700 focus:ring-2 focus:ring-sky-200";
const tinyLabelCls = "text-[11px] font-medium text-slate-500";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// A dropdown list with a checkbox on every row. Nothing checked = everything is included.
function CheckList<T extends string>({
  title,
  allLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  title: string;
  allLabel: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length <= 2
        ? options
            .filter((o) => selected.includes(o.value))
            .map((o) => o.label)
            .join(", ")
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="flex flex-col gap-1">
      <span className={tinyLabelCls}>{title}</span>
      <div className="relative">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${controlCls} flex w-full items-center justify-between gap-2 text-left`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            className={`size-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <ul className="max-h-60 overflow-y-auto py-1">
              {options.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">Nothing to choose yet.</li>
              ) : (
                options.map((o) => (
                  <li key={o.value}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-slate-900 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.includes(o.value)}
                        onChange={() => onToggle(o.value)}
                        className="size-4 accent-sky-700"
                      />
                      {o.label}
                    </label>
                  </li>
                ))
              )}
            </ul>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-sky-700 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const unpaidCols =
  "grid grid-cols-[minmax(150px,1.6fr)_70px_1.3fr_1fr_1fr_1fr_1.1fr_1.3fr] items-center gap-4";

const unpaidStatus: Record<UnpaidBill["status"], { text: string; cls: string }> = {
  overdue: { text: "Overdue", cls: "bg-red-100 text-red-800" },
  partial: { text: "Partial", cls: "bg-sky-100 text-sky-700" },
  pending: { text: "Payment pending", cls: "bg-amber-100 text-amber-800" },
  unpaid: { text: "Unpaid", cls: "bg-slate-100 text-slate-700" },
};

// Every tenant's bill that still has a balance, in one list
function UnpaidBillsTable({
  unpaid,
  error,
  onReview,
}: {
  unpaid: UnpaidBill[];
  error: string | null;
  onReview: (billId: string) => void;
}) {
  const total = unpaid.reduce((sum, u) => sum + Number(u.balance), 0);
  const hasOverdue = unpaid.some((u) => u.status === "overdue");

  return (
    <section
      className={`flex flex-col gap-4 rounded-2xl border bg-white p-6 ${
        hasOverdue ? "border-red-200" : unpaid.length > 0 ? "border-amber-200" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-slate-900">Unpaid bills</h2>
          <p className="text-sm text-slate-500">
            Every tenant&apos;s bill that still has a balance, including partly paid bills and
            bills from past months.
          </p>
        </div>
        {unpaid.length > 0 && !error && (
          <div className="flex flex-col items-end" title={formatPeso(total)}>
            <p className="text-xs text-slate-500">Total unpaid</p>
            <p className={`text-xl font-bold ${hasOverdue ? "text-red-800" : "text-slate-900"}`}>
              {peso(total)}
            </p>
          </div>
        )}
      </div>

      {error ? (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load the unpaid bills. Make sure you ran 022 in Supabase. ({error})
        </p>
      ) : unpaid.length === 0 ? (
        <p className="rounded-[10px] bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No unpaid bills. Every tenant is paid up.
        </p>
      ) : (
        <div className="max-h-[22rem] overflow-auto">
          <div className="min-w-[960px]">
            <div
              className={`${unpaidCols} sticky top-0 z-10 rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500`}
            >
              <span>Tenant</span>
              <span>Unit</span>
              <span>Due date</span>
              <span>Total</span>
              <span>Paid</span>
              <span>Balance</span>
              <span>Status</span>
              <span />
            </div>
            {unpaid.map((u) => {
              const s = unpaidStatus[u.status] ?? unpaidStatus.unpaid;
              return (
                <div
                  key={u.bill_id}
                  className={`${unpaidCols} border-b border-slate-100 px-3 py-3 text-sm last:border-b-0`}
                >
                  <span className="truncate font-semibold text-slate-900">{u.tenant_name}</span>
                  <span className="text-slate-900">{shortLabel(u.unit_label)}</span>
                  <span className="flex flex-col">
                    <span className="text-slate-900">{numericDate(u.due_date)}</span>
                    {u.status === "overdue" && Number(u.days_overdue) > 0 && (
                      <span className="text-xs text-slate-500">
                        {u.days_overdue} day{Number(u.days_overdue) === 1 ? "" : "s"} overdue
                      </span>
                    )}
                  </span>
                  <span className="text-slate-900">{formatPeso(Number(u.total_due))}</span>
                  <span className="text-slate-900">{formatPeso(Number(u.paid))}</span>
                  <span className="font-semibold text-slate-900">{formatPeso(Number(u.balance))}</span>
                  <span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>
                      {s.text}
                    </span>
                  </span>
                  <span className="flex justify-end gap-2">
                    {u.status === "pending" && u.pending && (
                      <Button type="button" onClick={() => onReview(u.bill_id)}>
                        Review payment
                      </Button>
                    )}
                    {u.status === "overdue" && (
                      <RpcButton
                        label="Send reminder"
                        doneLabel="Sent"
                        rpc="send_rent_reminder"
                        args={{ p_bill: u.bill_id }}
                      />
                    )}
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

function ReceiptsTable({
  receipts,
  error,
}: {
  receipts: ReceiptRecord[];
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<Method[]>([]); // none checked = all methods
  const [units, setUnits] = useState<string[]>([]); // none checked = all units
  const [statuses, setStatuses] = useState<PayStatus[]>([]); // none checked = all statuses

  const q = query.trim().toLowerCase();
  const qDate = q.replace(/[/.\s]/g, "-"); // 11/24/2026 and 11-24-2026 both work
  const filtering = q !== "" || methods.length > 0 || units.length > 0 || statuses.length > 0;
  const unitOptions = Array.from(new Set(receipts.map((r) => r.unit_label)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: shortLabel(value) }));
  const activeCount = methods.length + units.length + statuses.length;

  // The search box looks at the receipt no., the tenant (name or email) and the date paid.
  function textMatches(r: ReceiptRecord) {
    return (
      r.receipt_no.toLowerCase().includes(q) ||
      `${r.tenant_name} ${r.tenant_email ?? ""}`.toLowerCase().includes(q) ||
      numericDate(r.received_on).includes(qDate)
    );
  }

  const shown = filtering
    ? receipts.filter(
        (r) =>
          (q === "" || textMatches(r)) &&
          (methods.length === 0 || methods.includes(r.method)) &&
          (units.length === 0 || units.includes(r.unit_label)) &&
          (statuses.length === 0 || statuses.includes(r.pay_status))
      )
    : receipts;

  const filterKey = JSON.stringify([q, methods, units, statuses]);
  const [loaded, setLoaded] = useState({ key: filterKey, count: HISTORY_BATCH });
  const count = loaded.key === filterKey ? loaded.count : HISTORY_BATCH;
  const loading = useRef(false);
  const visible = shown.slice(0, count);
  const remaining = shown.length - visible.length;

  // A new batch has arrived, so reaching the bottom may load the next one
  useEffect(() => {
    loading.current = false;
  }, [count, filterKey]);

  function loadMore() {
    if (loading.current || remaining <= 0) return;
    loading.current = true;
    setLoaded({ key: filterKey, count: count + HISTORY_BATCH });
  }

  function onHistoryScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) loadMore();
  }

  function clearAll() {
    setQuery("");
    setMethods([]);
    setUnits([]);
    setStatuses([]);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-slate-900">Tenants&apos; Payment History</h2>
          <p className="text-sm text-slate-500">
            Saved permanently. They stay even if a tenant is removed or deletes their account. They are only deleted if you delete your own account.
          </p>
        </div>
        {receipts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className={tinyLabelCls}>Search</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Receipt no., tenant or date"
                  aria-label="Search payment history"
                  className={`${controlCls} w-[220px] sm:w-[280px]`}
                />
              </label>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className={`${controlCls} flex items-center gap-2 font-medium hover:bg-slate-50`}
              >
                Filters
                {activeCount > 0 && (
                  <span className="rounded-full bg-sky-700 px-1.5 text-xs font-semibold text-white">
                    {activeCount}
                  </span>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              You can search by receipt no., tenant&apos;s name or date paid (MM-DD-YYYY).
            </p>
          </div>
        )}
      </div>

      {open && receipts.length > 0 && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <CheckList
              title="Method"
              allLabel="All methods"
              options={methodOptions}
              selected={methods}
              onToggle={(v) => setMethods((s) => toggle(s, v))}
              onClear={() => setMethods([])}
            />
            <CheckList
              title="Unit"
              allLabel="All units"
              options={unitOptions}
              selected={units}
              onToggle={(v) => setUnits((s) => toggle(s, v))}
              onClear={() => setUnits([])}
            />
            <CheckList
              title="Status"
              allLabel="All statuses"
              options={statusOptions}
              selected={statuses}
              onToggle={(v) => setStatuses((s) => toggle(s, v))}
              onClear={() => setStatuses([])}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Check more than one to combine them. Leave a group empty to include everything in it.
            </p>
            <button
              type="button"
              onClick={clearAll}
              className="shrink-0 text-sm font-semibold text-sky-700 hover:underline"
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load the payment history. Please refresh and try again.
        </p>
      ) : receipts.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
          No payments yet. A record is saved each time a payment is confirmed.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
          Nothing matches your search.
        </p>
      ) : (
        <div
          onScroll={onHistoryScroll}
          className="h-[26rem] overflow-auto rounded-2xl border border-slate-200 bg-white"
        >
          <div className="min-w-[860px]">
            <div
              className={`${receiptCols} sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-3 text-xs font-semibold text-slate-500`}
            >
              <span>Receipt no.</span>
              <span>Date paid</span>
              <span>Tenant</span>
              <span>Unit</span>
              <span>Method</span>
              <span>Status</span>
              <span className="text-right">Receipt</span>
            </div>
            {visible.map((r) => {
              const s = receiptStatus[r.pay_status] ?? receiptStatus.fully_paid;
              return (
                <div
                  key={r.id}
                  className={`${receiptCols} border-b border-slate-100 px-6 py-3.5 text-sm last:border-b-0`}
                >
                  <span className="font-semibold text-slate-900">{r.receipt_no}</span>
                  <span className="text-slate-900">{numericDate(r.received_on)}</span>
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
                  <span className="flex justify-end">
                    <Link
                      href={`/landlord/rent-ledger/receipts/${r.id}`}
                      className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                    >
                      View receipt
                    </Link>
                  </span>
                </div>
              );
            })}
            {remaining > 0 && (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={loadMore}
                  className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                >
                  Load {Math.min(HISTORY_BATCH, remaining)} more
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!error && receipts.length > 0 && shown.length > 0 && (
        <p className="text-xs text-slate-500">
          Showing {visible.length} of {shown.length}
          {filtering ? ` matching (${receipts.length} in total)` : ""}
          {remaining > 0 ? ". Scroll down to see more." : "."}
        </p>
      )}
    </section>
  );
}

export function LedgerBoard({
  data,
  propertyName,
  receipts,
  receiptsError,
  unpaid,
  unpaidError,
}: {
  data: LedgerData;
  propertyId: string;
  propertyName: string;
  receipts: ReceiptRecord[];
  receiptsError: string | null;
  unpaid: UnpaidBill[];
  unpaidError: string | null;
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
  const overdueAmount = rows.reduce(
    (sum, r) => (r.status === "overdue" ? sum + Number(r.balance) : sum),
    0
  );
  const expected = Number(data.rent_expected ?? 0);
  const collected = Number(data.rent_collected ?? 0);
  const pendingAmount = Number(data.pending_amount ?? 0);
  // Money received this month (any confirmed payment). Falls back to the old % card until 021 is run.
  const hasReceived = data.rent_received !== undefined;
  const rentValue = hasReceived
    ? peso(Number(data.rent_received))
    : data.rent_received_pct === null
      ? "—"
      : `${data.rent_received_pct}%`;
  const rentNote = hasReceived
    ? data.rent_received_pct === null
      ? "Payments received this month"
      : `${data.rent_received_pct}% of ${peso(expected)} monthly rent billed`
    : data.rent_received_pct === null
      ? unbilledCount > 0
        ? "No bills generated for this month yet"
        : "No monthly rent bills this month"
      : data.rent_expected === undefined
        ? undefined
        : `${peso(collected)} of ${peso(expected)}`;

  // Looked up by id so the dialog always shows fresh data after a refresh
  const reviewing =
    rows.find(
      (r): r is BillLedgerRow => r.status !== "unbilled" && r.bill_id === reviewingId && !!r.pending
    ) ??
    unpaid
      .map(unpaidToRow)
      .find((r): r is BillLedgerRow => r !== null && r.bill_id === reviewingId) ??
    null;
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
            Create their bills so they can see and pay them.
          </p>
          <SiteButton href={`/landlord/rent-ledger/create-bills?month=${data.month}`}>
            Create bills
          </SiteButton>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <Stat
          value={rentValue}
          label="Rent received"
          note={rentNote}
          title={hasReceived ? formatPeso(Number(data.rent_received)) : undefined}
        />
        <Stat
          value={String(data.pending_count)}
          label="Pending payments"
          note={pendingAmount > 0 ? `${peso(pendingAmount)} awaiting your confirmation` : undefined}
        />
        <Stat
          value={String(overdueCount)}
          label="Overdue"
          note={overdueCount > 0 ? `${peso(overdueAmount)} past due` : undefined}
        />
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-lg font-bold text-slate-900">No tenants yet</p>
          <p className="text-sm text-slate-500">Tenants appear here once they join a unit.</p>
          <div className="mt-2">
            <SiteButton href="/landlord/units/invite">Add tenant</SiteButton>
          </div>
        </div>
      ) : (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-bold text-slate-900">This Month&apos;s Rents</h2>
              <p className="text-sm text-slate-500">
                Every tenant&apos;s rent for {month}. Review the payments your tenants have sent.
              </p>
            </div>
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
          </div>

          <div className="max-h-[22rem] overflow-auto">
            <div className="min-w-[960px]">
              <div
                className={`${unpaidCols} sticky top-0 z-10 rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500`}
              >
                <span>Tenant</span>
                <span>Unit</span>
                <span>Due date</span>
                <span>Total</span>
                <span>Paid</span>
                <span>Balance</span>
                <span>Status</span>
                <span />
              </div>

              {shown.length === 0 && (
                <p className="px-3 py-6 text-sm text-slate-500">Nothing in this list.</p>
              )}

              {shown.map((r) => {
                const b = statusBadge(r);
                const late = r.status === "overdue" ? daysOverdue(r.due_date) : 0;
                return (
                  <div
                    key={r.bill_id ?? r.lease_id}
                    className={`${unpaidCols} border-b border-slate-100 px-3 py-3 text-sm last:border-b-0`}
                  >
                    <span className="truncate font-semibold text-slate-900">{r.tenant_name}</span>
                    <span className="text-slate-900">{shortLabel(r.unit_label)}</span>
                    <span className="flex flex-col">
                      <span className="text-slate-900">
                        {r.status === "unbilled" ? "—" : numericDate(r.due_date)}
                      </span>
                      {late > 0 && (
                        <span className="text-xs text-slate-500">
                          {late} day{late === 1 ? "" : "s"} overdue
                        </span>
                      )}
                    </span>
                    <span className="text-slate-900">
                      {r.status === "unbilled" ? "—" : formatPeso(Number(r.total_due))}
                    </span>
                    <span className="text-slate-900">
                      {r.status === "unbilled" ? "—" : formatPeso(Number(r.paid))}
                    </span>
                    <span className="font-semibold text-slate-900">
                      {r.status === "unbilled" ? "—" : formatPeso(Number(r.balance))}
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
        </section>
      )}

      <UnpaidBillsTable unpaid={unpaid} error={unpaidError} onReview={setReviewingId} />

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