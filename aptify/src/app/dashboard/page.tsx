import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

// Landlords go to their area, everyone else to the tenant home.
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

  redirect((properties ?? []).length > 0 ? "/landlord" : "/tenant");
}
