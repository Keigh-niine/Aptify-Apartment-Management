import { MaintenanceInbox, type MaintenanceMailRow } from "@/components/tenant/maintenance/maintenance-inbox";
import { SiteButton } from "@/components/site-button";
import { getTenantContext } from "@/lib/tenant";

export const instant = false;

export default async function TenantMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { supabase, user, overview } = await getTenantContext();
  const { tab } = await searchParams;
  const active = tab === "open" || tab === "resolved" ? tab : "all";

  const hasUnit = !!overview?.has_lease;

  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("id, title, category, urgency, status, description, created_at")
    .eq("requested_by", user.id)
    .order("created_at", { ascending: false });

  const all = (data ?? []) as MaintenanceMailRow[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">Maintenance</h1>
          <p className="text-[15px] text-slate-500">
            {overview?.has_lease
              ? `Your repair requests for ${overview.unit_label}`
              : "Your repair requests"}
          </p>
        </div>
        {hasUnit && <SiteButton href="/tenant/maintenance/new">+ Request repair</SiteButton>}
      </div>

      {error && (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load your requests. Please refresh and try again.
        </p>
      )}

      {!hasUnit ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Join a unit to send repair requests to your landlord.
        </p>
      ) : all.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-lg font-bold text-slate-900">No repair requests yet</p>
          <p className="max-w-md text-sm text-slate-500">
            When something needs fixing, send a request and follow its progress here.
          </p>
          <div className="mt-2">
            <SiteButton href="/tenant/maintenance/new">Request repair</SiteButton>
          </div>
        </div>
      ) : (
        <MaintenanceInbox rows={all} initialTab={active} />
      )}
    </div>
  );
}