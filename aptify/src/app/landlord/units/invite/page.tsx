import { InviteWizard } from "@/components/landlord/units/invite-wizard";
import { SiteButton } from "@/components/site-button";
import { getLandlordContext } from "@/lib/landlord";
import { rowKind, sortRows, type UnitRow } from "@/lib/units";

export const instant = false;

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const { supabase, property } = await getLandlordContext();
  const { unit } = await searchParams;

  const { data, error } = await supabase.rpc("landlord_units", { p_property: property.id });

  if (error || !data) {
    return (
      <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
        Couldn&apos;t load your units. Make sure you ran 004_units_and_invites.sql in Supabase.
        {error ? ` (${error.message})` : ""}
      </p>
    );
  }

  const vacant = sortRows(data as UnitRow[])
    .filter((r) => rowKind(r) === "vacant")
    .map((r) => ({ id: r.unit_id, label: r.label, listed_rent: r.listed_rent }));

  if (vacant.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-[30px] font-bold text-slate-900">Add Tenant</h1>
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          There are no vacant units. Revoke a pending invite or remove a tenant to free up a unit.
        </p>
        <SiteButton href="/landlord/units" variant="outline">
          Back to units
        </SiteButton>
      </div>
    );
  }

  // First day of next month, computed here so server and browser agree.
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);

  return (
    <InviteWizard
      propertyName={property.name}
      units={vacant}
      initialUnitId={vacant.find((v) => v.id === unit)?.id ?? vacant[0].id}
      defaultStart={defaultStart}
    />
  );
}