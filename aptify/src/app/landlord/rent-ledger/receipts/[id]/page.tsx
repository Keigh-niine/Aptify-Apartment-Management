import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/tenant/payments/print-button";
import { formatDate, formatPeso } from "@/lib/format";
import { getLandlordContext } from "@/lib/landlord";
import { methodLabel, monthTitle, receiptStatus, type ReceiptRecord } from "@/lib/ledger";
import { UUID_RE } from "@/lib/tenant-payments";

export const instant = false;

type SavedReceipt = ReceiptRecord & {
  property_name: string;
  bill_total: number;
  balance_after: number;
  items: { description: string; amount: number }[];
};

// A saved receipt from the landlord's permanent records. It still opens after the tenant
// has been removed or has deleted their account.
export default async function LandlordReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, property } = await getLandlordContext();
  const { data, error } = await supabase
    .from("receipt_records")
    .select(
      "id, receipt_no, issued_at, tenant_name, tenant_email, unit_label, property_name, bill_type, billing_period, amount, method, reference_no, received_on, bill_total, balance_after, items, pay_status"
    )
    .eq("id", id)
    .eq("property_id", property.id)
    .maybeSingle();
  if (error || !data) notFound();
  const r = data as SavedReceipt;

  const status = receiptStatus[r.pay_status] ?? receiptStatus.fully_paid;
  const issuedOn = new Date(r.issued_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  const rows: [string, string][] = [
    ["Received from", r.tenant_name],
    ...(r.tenant_email ? ([["Email", r.tenant_email]] as [string, string][]) : []),
    ["Unit", `${r.unit_label} · ${r.property_name}`],
    ["Date paid", formatDate(r.received_on)],
    ["For", `${monthTitle(r.billing_period)} bill`],
    ["Method", methodLabel[r.method] ?? r.method],
    ...(r.reference_no ? ([["Reference", r.reference_no]] as [string, string][]) : []),
    ["Status", status.text],
  ];

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5">
      {/* When printing, show only the receipt */}
      <style>{`@media print { aside { display: none !important; } main { padding: 0 !important; } body { background: #fff !important; } .no-print { display: none !important; } }`}</style>

      <Link
        href="/landlord/rent-ledger"
        className="no-print w-fit text-[13px] font-semibold text-sky-700 hover:underline"
      >
        ← Rent ledger
      </Link>

      <article className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-sky-700 text-xl font-bold text-white">
              A
            </span>
            <span className="text-[22px] font-bold text-slate-900">Aptify</span>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-wider text-slate-500">OFFICIAL RECEIPT</p>
            <p className="text-lg font-bold text-slate-900">{r.receipt_no}</p>
          </div>
        </div>

        <div className="h-px bg-slate-200" />

        <div className="flex flex-col">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <span className="text-slate-500">{k}</span>
              <span className="text-right font-semibold text-slate-900">{v}</span>
            </div>
          ))}
        </div>

        <div className="h-px bg-slate-200" />

        <div className="flex flex-col">
          <p className="mb-1 text-[13px] font-semibold text-slate-900">Bill breakdown</p>
          {(r.items ?? []).map((it, i) => (
            <div key={`${it.description}-${i}`} className="flex justify-between gap-4 py-1 text-sm">
              <span className="text-slate-500">{it.description}</span>
              <span className="text-slate-900">{formatPeso(Number(it.amount))}</span>
            </div>
          ))}
        </div>

        <div className="h-px bg-slate-200" />

        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold text-slate-900">Total paid</span>
          <span className="text-2xl font-bold text-slate-900">{formatPeso(Number(r.amount))}</span>
        </div>
        <p className="text-xs text-slate-500">
          {Number(r.balance_after) <= 0
            ? "Paid in full."
            : `Balance remaining on this bill: ${formatPeso(Number(r.balance_after))}.`}
        </p>
        <p className="text-xs text-slate-400">
          Issued on {formatDate(issuedOn)}. This receipt was created by Aptify when the payment was
          confirmed, and is kept in your records.
        </p>
      </article>

      <div className="no-print flex gap-2.5">
        <PrintButton />
        <Link
          href="/landlord/rent-ledger"
          className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
        >
          Back to rent ledger
        </Link>
      </div>
    </div>
  );
}