import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export const instant = false;

// Landlords are sent to their own area. Tenants still see this placeholder
// until we build the tenant home screen.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: properties } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1);
  if ((properties ?? []).length > 0) redirect("/landlord");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .single();

  const { data: leases } = await supabase
    .from("leases")
    .select("id, unit_id")
    .eq("tenant_id", user.id)
    .eq("status", "active");

  const leaseUnitIds = (leases ?? []).map((l) => l.unit_id);
  const { data: rentedUnits } = leaseUnitIds.length
    ? await supabase.from("units").select("id, label, property_id").in("id", leaseUnitIds)
    : { data: [] as { id: string; label: string; property_id: string }[] };

  const rentedPropertyIds = (rentedUnits ?? []).map((u) => u.property_id);
  const { data: rentedProperties } = rentedPropertyIds.length
    ? await supabase.from("properties").select("id, name").in("id", rentedPropertyIds)
    : { data: [] as { id: string; name: string }[] };

  if ((rentedUnits ?? []).length > 0) redirect("/tenant");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          Hello, {profile?.first_name} {profile?.last_name}
        </h1>
        <SignOutButton />
      </div>
      <p className="text-sm text-slate-500">{user.email}</p>

      {(rentedUnits ?? []).length > 0 ? (
        <section className="rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-slate-900">You are a tenant</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
            {(rentedUnits ?? []).map((u) => (
              <li key={u.id}>
                {u.label} · {(rentedProperties ?? []).find((p) => p.id === u.property_id)?.name}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-700">
          You are not linked to a property or unit yet.
        </p>
      )}
    </main>
  );
}
