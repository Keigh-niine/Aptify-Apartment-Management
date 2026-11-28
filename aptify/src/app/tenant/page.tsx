import Link from "next/link";
import { connection } from "next/server";
import { SiteButton } from "@/components/site-button";
import { JoinUnitForm } from "@/components/tenant/join-unit-form";
import { formatPeso } from "@/lib/format";
import { methodLabel, monthTitle } from "@/lib/ledger";
import {
  daysUntil,
  getTenantContext,
  rejectionText,
  type TenantBill,
  type TenantOverview,
} from "@/lib/tenant";
import { ago } from "@/lib/time";

export const instant = false;

type Active = Extract<TenantOverview, { has_lease: true }>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const dueDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Chip({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{text}</span>
  );
}

const requestChip = {
  new: { text: "New", cls: "bg-amber-100 text-amber-800" },
  assigned: { text: "Assigned", cls: "bg-blue-100 text-blue-800" },
  resolved: { text: "Resolved", cls: "bg-green-100 text-green-800" },
} as const;

function historyChip(h: Active["history"][number]) {
  if (h.status === "confirmed") return { text: "Paid", cls: "bg-green-100 text-green-800" };
  if (h.status === "rejected") return { text: "Rejected", cls: "bg-red-100 text-red-800" };
  return {
    text: h.method === "cash" ? "Pending cash" : "Pending",
    cls: "bg-amber-100 text-amber-800",
  };
}

// ---------- The big rent card ----------
function RentCard({
  bill,
  olderCount,
  olderTotal,
}: {
  bill: TenantBill | null;
  olderCount: number;
  olderTotal: number;
}) {
  if (!bill && olderCount > 0) {
    // Nothing is open this month, but bills from earlier months are still unpaid
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-red-100 p-6">
        <p className="text-[15px] font-semibold text-red-800">
          You have unpaid bills from earlier months
        </p>
        <p className="text-[40px] font-bold leading-tight text-slate-900">{formatPeso(olderTotal)}</p>
        <p className="text-sm text-red-800">
          {olderCount} unpaid bill{olderCount === 1 ? "" : "s"}. Nothing new is due this month yet.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <SiteButton href="/tenant/payments">View unpaid bills</SiteButton>
        </div>
      </section>
    );
  }

  if (!bill) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-green-100 p-6">
        <p className="text-[15px] font-semibold text-green-800">You&apos;re all paid up</p>
        <p className="text-sm text-green-800">
          Nothing is due right now. Your next bill appears here when your landlord creates it.
        </p>
      </section>
    );
  }

  const what = bill.bill_type === "move_in" ? "Move-in payment" : "Rent";

  // A payment is waiting for the landlord
  if (bill.pending) {
    const p = bill.pending;
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-amber-100 p-6">
        <p className="text-[15px] font-semibold text-amber-800">Payment pending</p>
        <p className="text-[40px] font-bold leading-tight text-slate-900">
          {formatPeso(Number(p.amount))}
        </p>
        <p className="text-sm text-amber-800">
          {p.method === "cash" ? "Cash notice sent" : "Receipt sent"} {longDate(p.created_at)}
        </p>
        <div className="flex flex-wrap gap-2.5">
          <SiteButton href="/tenant/payments" variant="outline">
            View details
          </SiteButton>
        </div>
        <p className="text-xs text-amber-800">
          Your payment counts once your landlord confirms the money arrived. You will get a receipt
          then.
        </p>
      </section>
    );
  }

  const days = daysUntil(bill.due_date);
  const overdue = days < 0;
  const tone = overdue
    ? { box: "bg-red-100", text: "text-red-800" }
    : { box: "bg-amber-100", text: "text-amber-800" };

  const title = overdue
    ? `${what} is ${-days} day${-days === 1 ? "" : "s"} overdue`
    : days === 0
      ? `${what} is due today`
      : `${what} is due in ${days} day${days === 1 ? "" : "s"}`;

  return (
    <section className={`flex flex-col gap-3 rounded-2xl p-6 ${tone.box}`}>
      <p className={`text-[15px] font-semibold ${tone.text}`}>{title}</p>

      {bill.rejected && (
        <p className="rounded-[10px] bg-white/70 px-3 py-2 text-xs font-medium text-red-800">
          Your landlord couldn&apos;t confirm your last payment of{" "}
          {formatPeso(Number(bill.rejected.amount))}. {rejectionText[bill.rejected.reason]}{" "}
          {bill.rejected.message ? `“${bill.rejected.message}”` : ""}
        </p>
      )}

      <p className="text-[40px] font-bold leading-tight text-slate-900">
        {formatPeso(Number(bill.balance))}
      </p>
      <p className={`text-sm ${tone.text}`}>
        {overdue ? "Was due" : "Due"} {dueDate(bill.due_date)}
      </p>
      <div className="flex flex-wrap gap-2.5">
        <SiteButton href={`/tenant/payments/pay?bill=${bill.bill_id}&method=online`}>Pay online</SiteButton>
        <SiteButton href={`/tenant/payments/pay?bill=${bill.bill_id}&method=cash`} variant="outline">
          Pay with cash
        </SiteButton>
      </div>
      <p className={`text-xs ${tone.text}`}>
        Online payments and cash payments both count once your landlord confirms them.
      </p>
    </section>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-[24rem] flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {/* The card keeps its size; the list inside scrolls */}
      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-2">{children}</div>
    </section>
  );
}

export default async function TenantHomePage() {
  await connection();
  const { overview, overviewError } = await getTenantContext();

  if (overviewError || !overview) {
    if (overviewError) console.error("tenant_overview failed:", overviewError);
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-bold text-slate-900">My Home</h1>
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load your home screen. Please refresh and try again.
        </p>
      </div>
    );
  }

  if (!overview.has_lease) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[30px] font-bold text-slate-900">My Home</h1>
        <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-lg font-bold text-slate-900">You&apos;re not linked to a unit yet</p>
          <p className="text-sm text-slate-500">
            Enter the invite code from your landlord. Once you join a unit, your rent, repairs and
            announcements show up here.
          </p>
          <div className="mt-3">
            <JoinUnitForm />
          </div>
        </div>
      </div>
    );
  }

  const o = overview;
  const olderCount = Number(o.unpaid_count ?? 0); // unpaid bills from months that have ended
  const olderTotal = Number(o.unpaid_total ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">My Home</h1>
        <p className="text-[15px] text-slate-500">
          {o.unit_label} · {o.property_name}
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <RentCard bill={o.current_bill} olderCount={olderCount} olderTotal={olderTotal} />
          {o.current_bill && olderCount > 0 && (
            <Link
              href="/tenant/payments"
              className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-white px-5 py-3.5 text-sm hover:bg-red-50"
            >
              <span className="text-slate-900">
                <span className="font-semibold text-red-800">
                  {olderCount} unpaid bill{olderCount === 1 ? "" : "s"} from earlier months
                </span>{" "}
                · {formatPeso(olderTotal)} still owed
              </span>
              <span className="shrink-0 font-semibold text-sky-700">View</span>
            </Link>
          )}
        </div>

        <Card title="Payment history">
          {o.history.length === 0 && <p className="py-2 text-sm text-slate-500">No payments yet.</p>}
          {o.history.map((h) => {
            const chip = historyChip(h);
            return (
              <div key={h.id} className="flex items-center justify-between gap-3 py-1">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-semibold text-slate-900">
                    {monthTitle(h.billing_period)}
                    {h.bill_type === "move_in" ? " (move-in)" : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatPeso(Number(h.amount))} · {methodLabel[h.method]}
                  </p>
                </div>
                <Chip text={chip.text} cls={chip.cls} />
              </div>
            );
          })}
        </Card>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card
          title="Maintenance requests"
          action={
            <SiteButton href="/tenant/maintenance/new">Request repair</SiteButton>
          }
        >
          {o.requests.length === 0 && (
            <p className="py-2 text-sm text-slate-500">You have no repair requests.</p>
          )}
          {o.requests.map((r) => {
            const chip = requestChip[r.status];
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 py-1">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-sm font-semibold text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-500">
                    {cap(r.category)} · {cap(r.urgency)}
                  </p>
                </div>
                <Chip text={chip.text} cls={chip.cls} />
              </div>
            );
          })}
        </Card>

        <Card
          title="Announcements"
          action={
            <Link
              href="/tenant/mail"
              className="text-sm font-semibold text-sky-700 hover:underline"
            >
              View all
            </Link>
          }
        >
          {o.announcements.length === 0 && (
            <p className="py-2 text-sm text-slate-500">No announcements yet.</p>
          )}
          {o.announcements.map((a) => (
            <div key={a.id} className="flex flex-col gap-0.5 py-1">
              <p className="text-sm font-semibold text-slate-900">{a.title}</p>
              <p className="text-xs text-slate-500">
                {cap(ago(a.published_at))} · Posted by your landlord
              </p>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}