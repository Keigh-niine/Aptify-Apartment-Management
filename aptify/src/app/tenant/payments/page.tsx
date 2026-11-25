import Link from "next/link";
import { SiteButton } from "@/components/site-button";
import { formatPeso } from "@/lib/format";
import { methodLabel, monthTitle } from "@/lib/ledger";
import { daysUntil, getTenantContext, rejectionText } from "@/lib/tenant";
import type { HistoryRow, PaymentsData } from "@/lib/tenant-payments";

export const instant = false;

const dueDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// "2026-11-12" -> "11/12/2026"
const slashDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
};

// "2026-11-24T09:15:00+00:00" -> "11/24/2026" in Philippine time (same format as the Unpaid bills dates)
const paidDate = (ts: string) =>
  slashDate(new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));

function statusChip(h: HistoryRow) {
  if (h.status === "confirmed") return { text: "Paid", cls: "bg-green-100 text-green-800" };
  if (h.status === "rejected") return { text: "Rejected", cls: "bg-red-100 text-red-800" };
  return { text: h.method === "cash" ? "Pending cash" : "Pending", cls: "bg-amber-100 text-amber-800" };
}

const outline =
  "inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50";

export default async function TenantPaymentsPage() {
  const { supabase } = await getTenantContext();
  const { data, error } = await supabase.rpc("tenant_payments");
  const p = data as PaymentsData | null;

  if (error || !p) {
    if (error) console.error("tenant_payments failed:", error.message);
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-bold text-slate-900">Payments</h1>
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load your payments. Please refresh and try again.
        </p>
      </div>
    );
  }

  if (!p.has_lease) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[30px] font-bold text-slate-900">Payments</h1>
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Join a unit to see your bills and payments.
        </p>
      </div>
    );
  }

  const b = p.current_bill;
  const unpaid = p.unpaid_bills ?? [];
  const unpaidTotal = unpaid.reduce((sum, u) => sum + Number(u.balance), 0);
  const hasOverdue = unpaid.some((u) => u.is_past);
  const days = b ? daysUntil(b.due_date) : 0;
  const overdue = !!b && days < 0;
  const chip = !b
    ? null
    : b.pending
      ? { text: "Payment pending", cls: "bg-amber-100 text-amber-800" }
      : overdue
        ? { text: `${-days} day${-days === 1 ? "" : "s"} overdue`, cls: "bg-red-100 text-red-800" }
        : { text: days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`, cls: "bg-amber-100 text-amber-800" };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Payments</h1>
        <p className="text-[15px] text-slate-500">
          {p.unit_label} · {p.property_name}
        </p>
      </div>

      {/* The bill due next */}
      {b ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-[15px] text-slate-500">
                {monthTitle(b.billing_period)}
                {b.bill_type === "move_in" ? " move-in" : ""} bill
              </p>
              <p className="text-[40px] font-bold leading-tight text-slate-900">
                {formatPeso(Number(b.pending ? b.pending.amount : b.balance))}
              </p>
              <p className="text-xs text-slate-500">
                {b.pending
                  ? `${b.pending.method === "cash" ? "Cash notice" : "Receipt"} sent. Waiting for your landlord to confirm`
                  : `Due ${dueDate(b.due_date)} · ${b.item_names.join(", ")}`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2.5">
              {chip && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip.cls}`}>
                  {chip.text}
                </span>
              )}
              <div className="flex flex-wrap justify-end gap-2.5">
                <Link href={`/tenant/payments/pay?bill=${b.bill_id}`} className={outline}>
                  View details
                </Link>
                {!b.pending && (
                  <>
                    <SiteButton href={`/tenant/payments/pay?bill=${b.bill_id}&method=cash`} variant="outline">
                      Pay with cash
                    </SiteButton>
                    <SiteButton href={`/tenant/payments/pay?bill=${b.bill_id}&method=online`}>
                      Pay online
                    </SiteButton>
                  </>
                )}
              </div>
            </div>
          </div>

          {b.rejected && !b.pending && (
            <p className="rounded-[10px] bg-red-100 px-3 py-2 text-xs font-medium text-red-800">
              Your landlord couldn&apos;t confirm your last payment of {formatPeso(Number(b.rejected.amount))}.{" "}
              {rejectionText[b.rejected.reason]} {b.rejected.message ? `“${b.rejected.message}”` : ""}
            </p>
          )}
        </section>
      ) : unpaid.length === 0 ? (
        <section className="flex flex-col gap-1 rounded-2xl bg-green-100 p-6">
          <p className="text-[15px] font-semibold text-green-800">You&apos;re all paid up</p>
          <p className="text-sm text-green-800">
            Nothing is due right now. Your next bill appears here when your landlord creates it.
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-[15px] font-semibold text-slate-900">Nothing else is due this month</p>
          <p className="text-sm text-slate-500">Please settle your unpaid bills below.</p>
        </section>
      )}

      {/* Unpaid bills: bills you've partly paid and bills from months that have ended */}
      <section
        className={`flex flex-col gap-4 rounded-2xl border bg-white p-6 ${
          hasOverdue ? "border-red-200" : unpaid.length > 0 ? "border-amber-200" : "border-slate-200"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold text-slate-900">Unpaid bills</h2>
            <p className="text-sm text-slate-500">
              Bills you&apos;ve partly paid and bills from past months. A balance that isn&apos;t paid
              by the end of its month becomes overdue.
            </p>
          </div>
          {unpaid.length > 0 && (
            <div className="flex flex-col items-end">
              <p className="text-xs text-slate-500">Total unpaid</p>
              <p className={`text-xl font-bold ${hasOverdue ? "text-red-800" : "text-slate-900"}`}>
                {formatPeso(unpaidTotal)}
              </p>
            </div>
          )}
        </div>

        {unpaid.length === 0 ? (
          <p className="rounded-[10px] bg-slate-50 px-4 py-3 text-sm text-slate-500">
            You have no unpaid bills. If you pay part of a bill, or a month ends with a balance
            left, that bill will be listed here so you can finish paying it.
          </p>
        ) : (
          /* Fixed-height table: scroll up and down when there are many bills */
          <div className="max-h-[22rem] overflow-auto">
            <div className="min-w-[760px]">
              <div className="sticky top-0 z-10 grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1.6fr] gap-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500">
                <span>Due date</span>
                <span>Total</span>
                <span>Paid</span>
                <span>Balance</span>
                <span>Status</span>
                <span />
              </div>
              {unpaid.map((u) => {
                const uChip = u.pending
                  ? { text: "Payment pending", cls: "bg-amber-100 text-amber-800" }
                  : u.is_past
                    ? { text: "Overdue", cls: "bg-red-100 text-red-800" }
                    : { text: "Partial", cls: "bg-sky-100 text-sky-700" };
                const note = u.pending
                  ? "Waiting for your landlord to confirm"
                  : u.is_past && Number(u.days_overdue) > 0
                    ? `${u.days_overdue} day${u.days_overdue === 1 ? "" : "s"} overdue`
                    : null;
                return (
                  <div key={u.bill_id} className="border-b border-slate-100 px-3 py-3 last:border-b-0">
                    <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1.6fr] items-center gap-4 text-sm">
                      <span className="flex flex-col">
                        <span className="font-semibold text-slate-900">
                          {slashDate(u.due_date)}
                          {u.bill_type === "move_in" ? " (move-in)" : ""}
                        </span>
                        {note && <span className="text-xs text-slate-500">{note}</span>}
                      </span>
                      <span className="text-slate-900">{formatPeso(Number(u.total_due))}</span>
                      <span className="text-slate-900">{formatPeso(Number(u.paid))}</span>
                      <span className="font-semibold text-slate-900">{formatPeso(Number(u.balance))}</span>
                      <span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${uChip.cls}`}>
                          {uChip.text}
                        </span>
                      </span>
                      <span className="flex justify-end">
                        {!u.pending && (
                          <SiteButton href={`/tenant/payments/pay?bill=${u.bill_id}`} className="whitespace-nowrap">
                            Proceed to payment
                          </SiteButton>
                        )}
                      </span>
                    </div>
                    {u.rejected && !u.pending && (
                      <p className="mt-2 rounded-[10px] bg-red-100 px-3 py-2 text-xs font-medium text-red-800">
                        Your landlord couldn&apos;t confirm your last payment of{" "}
                        {formatPeso(Number(u.rejected.amount))}. {rejectionText[u.rejected.reason]}{" "}
                        {u.rejected.message ? `“${u.rejected.message}”` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* History */}
      <section className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">Payment history</h2>
        {p.history.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">No payments yet.</p>
        ) : (
          <div className="max-h-[22rem] overflow-auto">
            <div className="min-w-[640px]">
              <div className="sticky top-0 z-10 grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500">
                <span>Date</span>
                <span>Amount</span>
                <span>Method</span>
                <span>Status</span>
                <span />
              </div>
              {p.history.map((h) => {
                const c = statusChip(h);
                return (
                  <div
                    key={h.id}
                    className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center gap-4 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0"
                  >
                    <span className="font-semibold text-slate-900">
                      {paidDate(h.created_at)}
                      {h.bill_type === "move_in" ? " (move-in)" : ""}
                    </span>
                    <span className="text-slate-900">{formatPeso(Number(h.amount))}</span>
                    <span className="text-slate-900">{methodLabel[h.method]}</span>
                    <span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${c.cls}`}>{c.text}</span>
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
            </div>
          </div>
        )}
      </section>
    </div>
  );
}