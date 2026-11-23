import { connection } from "next/server";
import { Sidebar } from "@/components/tenant/sidebar";
import { ToastProvider } from "@/components/toast";
import { getTenantContext } from "@/lib/tenant";

export const instant = false;

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const { profile, overview } = await getTenantContext();
  const initials =
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "TE";

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-slate-100">
        <Sidebar
          initials={initials}
          firstName={profile?.first_name ?? "Tenant"}
          unitLabel={overview?.has_lease ? overview.unit_label : "No unit yet"}
        />
        <main className="min-w-0 flex-1 p-6 lg:p-10">{children}</main>
      </div>
    </ToastProvider>
  );
}
