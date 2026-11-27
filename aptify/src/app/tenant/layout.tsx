import { connection } from "next/server";
import { Sidebar } from "@/components/tenant/sidebar";
import { ToastProvider } from "@/components/toast";
import { getTenantContext } from "@/lib/tenant";
import { TENANT_NOTIFICATION_TYPES } from "@/lib/tenant-notifications";

export const instant = false;

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const { supabase, user, profile, overview } = await getTenantContext();

  // Unread notifications for the badge in the sidebar
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .in("type", [...TENANT_NOTIFICATION_TYPES])
    .is("read_at", null);
  const initials =
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "TE";

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-slate-100">
        <Sidebar
          initials={initials}
          firstName={profile?.first_name ?? "Tenant"}
          unitLabel={overview?.has_lease ? overview.unit_label : "No unit yet"}
          unreadCount={unreadCount ?? 0}
        />
        <main className="min-w-0 flex-1 p-6 lg:p-10">{children}</main>
      </div>
    </ToastProvider>
  );
}