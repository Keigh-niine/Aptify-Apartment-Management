import { SettingsView } from "@/components/settings/settings-view";
import { getTenantContext } from "@/lib/tenant";

export const instant = false;

// Same Settings screen as the landlord's, without the payment details (GCash / Maya).
export default async function TenantSettingsPage() {
  const { supabase, user } = await getTenantContext();

  const [{ data: profile }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name, phone").eq("id", user.id).single(),
    supabase
      .from("notification_preferences")
      .select("rent_reminders, repair_updates, announcements")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Settings</h1>
        <p className="text-[15px] text-slate-500">Manage your account</p>
      </div>

      <SettingsView
        role="tenant"
        userId={user.id}
        email={user.email ?? ""}
        profile={{
          firstName: profile?.first_name ?? "",
          lastName: profile?.last_name ?? "",
          phone: profile?.phone ?? "",
        }}
        prefs={{
          rent_reminders: prefs?.rent_reminders ?? true,
          repair_updates: prefs?.repair_updates ?? true,
          announcements: prefs?.announcements ?? true,
        }}
      />
    </div>
  );
}
