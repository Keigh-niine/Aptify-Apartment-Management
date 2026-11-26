import Link from "next/link";
import { CreateBillsForm } from "@/components/landlord/ledger/create-bills-form";
import type { BillPreview } from "@/lib/bill-preview";
import { getLandlordContext } from "@/lib/landlord";
import { monthTitle } from "@/lib/ledger";

export const instant = false;

// Step before bills exist: enter the variable charges (water, electricity...) for the month.
export default async function CreateBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const { supabase, property } = await getLandlordContext();

  const { data, error } = await supabase.rpc("landlord_bill_preview", {
    p_property: property.id,
    p_month: month && /^\d{4}-\d{2}-01$/.test(month) ? month : null,
  });

  if (error || !data) {
    if (error) console.error("landlord_bill_preview failed:", error.message);
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-bold text-slate-900">Create bills</h1>
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load the bills to create. Make sure you ran 025_create_bills_with_variables.sql in
          Supabase, then refresh.
        </p>
      </div>
    );
  }

  const preview = data as BillPreview;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/landlord/rent-ledger"
          className="w-fit text-[13px] font-semibold text-sky-700 hover:underline"
        >
          ← Rent ledger
        </Link>
        <h1 className="text-[30px] font-bold text-slate-900">Create bills</h1>
        <p className="text-[15px] text-slate-500">
          {monthTitle(preview.month)} · {property.name}
        </p>
      </div>

      <CreateBillsForm preview={preview} propertyId={property.id} />
    </div>
  );
}