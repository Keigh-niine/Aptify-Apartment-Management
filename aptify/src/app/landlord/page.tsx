import Link from "next/link";
import { RpcButton } from "@/components/landlord/rpc-button";
import { formatPeso } from "@/lib/format";
import {
  ago,
  getLandlordContext,
  type AttentionItem,
  type OverviewAnnouncement,
  type OverviewData,
} from "@/lib/landlord";
import { shortLabel } from "@/lib/signup";

export const instant = false;

const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

const reviewLink =
  "inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50";

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-[32px] font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const unit = shortLabel(item.unit_label);
  let title: string;
  let sub: string;
  let action: React.ReactNode;

  if (item.kind === "cash") {
    title = `${item.person} (${unit}) says cash is ready`;
    sub = `Pending cash · ${formatPeso(Number(item.amount))}`;
    action = (
      <RpcButton variant="primary" label="Confirm" rpc="confirm_payment" args={{ p_payment: item.id }} />
    );
  } else if (item.kind === "repair") {
    title = `${item.unit_label}: ${item.title}`;
    sub = `${cap(item.urgency)} · New ${ago(item.sort_at)}`;
    action = (
      <Link href="/landlord/maintenance" className={reviewLink}>
        Review
      </Link>
    );
  } else {
    const days = item.days_overdue ?? 0;
    title = `${item.person} (${unit}) is ${days} day${days === 1 ? "" : "s"} overdue`;
    sub = `Overdue · ${formatPeso(Number(item.amount))}`;
    action = (
      <RpcButton label="Remind" doneLabel="Sent" rpc="send_rent_reminder" args={{ p_bill: item.id }} />
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function AnnouncementRow({ a }: { a: OverviewAnnouncement }) {
  const audience =
    a.audience === "property" ? "Whole property" : `${a.unit_count} unit${a.unit_count === 1 ? "" : "s"}`;
  const sent = a.status === "published";

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-sm font-semibold text-slate-900">{a.title}</p>
        <p className="text-xs text-slate-500">
          {audience} · {sent ? ago(a.at) : "Draft"}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
          sent ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"
        }`}
      >
        {sent ? "Sent" : "Draft"}
      </span>
    </div>
  );
}

export default async function OverviewPage() {
  const { supabase, user, property } = await getLandlordContext();

  const { data, error } = await supabase.rpc("landlord_overview", { p_property: property.id });
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Has the landlord added GCash / Maya details yet? (null if the table is missing)
  const { count: paymentAccounts } = await supabase
    .from("payment_accounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);

  if (error || !data) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-bold text-slate-900">Overview</h1>
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load the overview. Make sure you ran 003_landlord_overview.sql in Supabase.
          {error ? ` (${error.message})` : ""}
        </p>
      </div>
    );
  }

  const o = data as OverviewData;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Overview</h1>
        <p className="text-[15px] text-slate-500">
          {property.name} · {month}
        </p>
      </div>

      {paymentAccounts === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-100 p-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-amber-800">Add your payment details</p>
            <p className="text-xs text-amber-800">
              Tenants need your GCash or Maya number or QR code to pay you online.
            </p>
          </div>
          <Link
            href="/landlord/settings"
            className="inline-flex items-center justify-center rounded-[10px] bg-sky-700 px-3.5 py-[7px] text-sm font-semibold text-white transition-colors hover:bg-sky-800"
          >
            Go to Settings
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat
          value={o.rent_received_pct === null ? "—" : `${o.rent_received_pct}%`}
          label="Rent received"
        />
        <Stat value={String(o.pending_cash)} label="Pending cash" />
        <Stat value={String(o.open_repairs)} label="Open repairs" />
        <Stat value={String(o.vacant_units)} label="Vacant units" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 text-lg font-bold text-slate-900">Needs attention</h2>
          {o.attention.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">You&apos;re all caught up.</p>
          ) : (
            o.attention.map((item) => <AttentionRow key={`${item.kind}-${item.id}`} item={item} />)
          )}
        </section>

        <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Recent announcements</h2>
            <Link
              href="/landlord/announcements"
              className="inline-flex items-center justify-center rounded-[10px] bg-sky-700 px-3.5 py-[7px] text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              New
            </Link>
          </div>
          {o.announcements.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">No announcements yet.</p>
          ) : (
            o.announcements.map((a) => <AnnouncementRow key={a.id} a={a} />)
          )}
        </section>
      </div>
    </div>
  );
}
