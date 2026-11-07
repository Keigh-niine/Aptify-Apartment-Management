import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const getTenantContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: leases }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    supabase.from("leases").select("unit_id").eq("tenant_id", user.id).eq("status", "active"),
  ]);

  const unitIds = (leases ?? []).map((lease) => lease.unit_id);
  if (unitIds.length === 0) redirect("/dashboard");

  const { data: units } = await supabase
    .from("units")
    .select("label, property_id")
    .in("id", unitIds)
    .limit(1);
  const unit = units?.[0];

  const { data: property } = unit
    ? await supabase.from("properties").select("name").eq("id", unit.property_id).single()
    : { data: null };

  return {
    profile,
    propertyName: property?.name ?? "Your home",
    unitLabel: unit?.label ?? "",
  };
});