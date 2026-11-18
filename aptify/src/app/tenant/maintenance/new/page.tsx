import { RequestForm } from "@/components/tenant/maintenance/request-form";
import { getTenantContext } from "@/lib/tenant";

export const instant = false;

export default async function NewRequestPage() {
  const { supabase, user } = await getTenantContext();

  // The request is filed against the tenant's current unit
  const { data: lease } = await supabase
    .from("leases")
    .select("unit_id")
    .eq("tenant_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Request a repair</h1>
        <p className="text-[15px] text-slate-500">Tell your landlord what needs fixing</p>
      </div>

      {lease ? (
        <RequestForm unitId={lease.unit_id} userId={user.id} />
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Join a unit before sending a repair request.
        </p>
      )}
    </div>
  );
}
