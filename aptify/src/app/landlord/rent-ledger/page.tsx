import { LedgerBoard } from "@/components/landlord/ledger/ledger-board";
import { getLandlordContext } from "@/lib/landlord";
import type { LedgerData, ReceiptRecord, UnpaidBill } from "@/lib/ledger";

export const instant = false;

export default async function RentLedgerPage() {
  const { supabase, property } = await getLandlordContext();

  const { data, error } = await supabase.rpc("landlord_ledger", { p_property: property.id });

  if (error || !data) {
    if (error) console.error("landlord_ledger failed:", error.message);
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-bold text-slate-900">Rent ledger</h1>
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load the rent ledger. Please refresh and try again.
        </p>
      </div>
    );
  }

  const ledger = data as LedgerData;

  // Every tenant's bill that still has a balance
  const { data: unpaidRows, error: unpaidError } = await supabase.rpc("landlord_unpaid_bills", {
    p_property: property.id,
  });
  if (unpaidError) console.error("landlord_unpaid_bills failed:", unpaidError.message);
  const unpaid = (unpaidRows ?? []) as UnpaidBill[];

  // Receipt images are in a private bucket, so each one needs a temporary link.
  const paths = [
    ...ledger.rows.flatMap((r) => (r.pending?.receipt_path ? [r.pending.receipt_path] : [])),
    ...unpaid.flatMap((u) => (u.pending?.receipt_path ? [u.pending.receipt_path] : [])),
  ];
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("payment-receipts")
      .createSignedUrls(paths, 3600);
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    });
  }

  const withUrls: LedgerData = {
    ...ledger,
    rows: ledger.rows.map((r) =>
      r.pending
        ? {
            ...r,
            pending: {
              ...r.pending,
              receipt_url: r.pending.receipt_path ? (urls.get(r.pending.receipt_path) ?? null) : null,
            },
          }
        : r
    ),
  };

  const unpaidWithUrls: UnpaidBill[] = unpaid.map((u) =>
    u.pending
      ? {
          ...u,
          pending: {
            ...u.pending,
            receipt_url: u.pending.receipt_path ? (urls.get(u.pending.receipt_path) ?? null) : null,
          },
        }
      : u
  );

  // Permanent receipt records. They stay even if the tenant is removed or deletes their account.
  const { data: receiptRows, error: receiptsError } = await supabase
    .from("receipt_records")
    .select(
      "id, receipt_no, issued_at, tenant_name, tenant_email, unit_label, bill_type, billing_period, amount, method, reference_no, received_on, pay_status"
    )
    .eq("property_id", property.id)
    .order("issued_at", { ascending: false })
    .limit(500);

  if (receiptsError) console.error("receipt_records failed:", receiptsError.message);

  return (
    <LedgerBoard
      data={withUrls}
      propertyId={property.id}
      propertyName={property.name}
      receipts={(receiptRows ?? []) as ReceiptRecord[]}
      receiptsError={receiptsError ? "load_failed" : null}
      unpaid={unpaidWithUrls}
      unpaidError={unpaidError ? "load_failed" : null}
    />
  );
}