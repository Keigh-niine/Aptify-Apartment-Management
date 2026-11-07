import { TenantSidebar } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/tenant";

export const instant = false;

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const { profile, propertyName, unitLabel } = await getTenantContext();
  const initials =
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "TE";
  const homeName = unitLabel ? `${unitLabel} · ${propertyName}` : propertyName;

  return (
    <div className="flex min-h-screen bg-slate-100">
      <TenantSidebar
        initials={initials}
        firstName={profile?.first_name ?? "Tenant"}
        propertyName={homeName}
      />
      <main className="min-w-0 flex-1 p-6 lg:p-10">{children}</main>
    </div>
  );
}