import { SiteButton } from "@/components/site-button";
import { UnitsTable } from "@/components/landlord/units/units-table";
import { getLandlordContext } from "@/lib/landlord";
import { sortRows, type UnitRow } from "@/lib/units";

export const instant = false;

export default async function UnitsPage() {
  const { supabase, property } = await getLandlordContext();
  const { data, error } = await supabase.rpc("landlord_units", { p_property: property.id });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">Units and invites</h1>
          <p className="text-[15px] text-slate-500">Manage your units and tenants</p>
        </div>
        <SiteButton href="/landlord/units/invite">+ Add Tenant</SiteButton>
      </div>

      {error || !data ? (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load your units. Make sure you ran 004_units_and_invites.sql in Supabase.
          {error ? ` (${error.message})` : ""}
        </p>
      ) : (
        <UnitsTable rows={sortRows(data as UnitRow[])} />
      )}
    </div>
  );
}
