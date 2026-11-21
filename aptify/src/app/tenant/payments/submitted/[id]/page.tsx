import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteButton } from "@/components/site-button";
import { formatPeso } from "@/lib/format";
import { methodLabel, monthTitle } from "@/lib/ledger";
import { getTenantContext } from "@/lib/tenant";
import { UUID_RE } from "@/lib/tenant-payments";

export const instant = false;

export default async function PaymentSubmittedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, user } = await getTenantContext();

  const { data: pay } = await supabase
    .from("payments")
    .select("amount, method, reference_no, status, created_at, planned_date, bill_id, payer_id")
    .eq("id", id)
    .maybeSingle();
  if (!pay || pay.payer_id !== user.id) notFound();

  const { data: bill } = await supabase
    .from("bills")
    .select("billing_period")
    .eq("id", pay.bill_id)
    .maybeSingle();

  const isCash = pay.method === "cash";
  const status =
    pay.status === "confirmed" ? "Confirmed" : pay.status === "rejected" ? "Rejected" : "Waiting for your landlord";

  const rows: [string, string][] = [
    [isCash ? "Amount to pay" : "Amount sent", formatPeso(Number(pay.amount))],
    ["Bill", bill ? monthTitle(bill.billing_period) : "—"],
    ["Method", methodLabel[pay.method] ?? pay.method],
    ...(isCash
      ? ([["Planned date", pay.planned_date ? new Date(pay.planned_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"]] as [string, string][])
      : ([["Reference", pay.reference_no || "Not provided"]] as [string, string][])),
    ["Status", status],
  ];

  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4 py-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-green-100 text-2xl font-bold text-green-800">
        ✓
      </span>
      <h1 className="text-[28px] font-bold text-slate-900">{isCash ? "Notice sent" : "Receipt sent"}</h1>
      <p className="text-sm text-slate-500">
        {isCash
          ? "Your landlord has your notice. Your payment counts once they confirm it."
          : "Your landlord has your receipt. Your payment counts once they confirm it."}
      </p>

      <div className="flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 py-1.5 text-sm">
            <span className="text-slate-500">{k}</span>
            <span className="text-right font-semibold text-slate-900">{v}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2.5">
        <SiteButton href="/tenant/payments">Back to payments</SiteButton>
        <Link
          href="/tenant"
          className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
