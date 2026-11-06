import { Sidebar } from "@/components/landlord/sidebar";
import { ToastProvider } from "@/components/toast";
import { getLandlordContext } from "@/lib/landlord";

export const instant = false;

export default async function LandlordLayout({ children }: { children: React.ReactNode }) {
  const { profile, property } = await getLandlordContext();
  const initials =
    `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase() || "LA";

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-slate-100">
        <Sidebar
          initials={initials}
          firstName={profile?.first_name ?? "Landlord"}
          propertyName={property.name}
        />
        <main className="min-w-0 flex-1 p-6 lg:p-10">{children}</main>
      </div>
    </ToastProvider>
  );
}
