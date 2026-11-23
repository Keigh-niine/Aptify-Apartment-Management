import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1);
  console.log("dashboard check:", user.id, user.email, properties, error);

  redirect((properties ?? []).length > 0 ? "/landlord" : "/tenant");
}