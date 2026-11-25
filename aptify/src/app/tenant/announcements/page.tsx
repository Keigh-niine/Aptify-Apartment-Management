import { AnnouncementsList, type TenantAnnouncement } from "@/components/tenant/announcements-list";
import { getTenantContext } from "@/lib/tenant";

export const instant = false;

export default async function TenantAnnouncementsPage() {
  const { supabase, user, overview } = await getTenantContext();

  const { data, error } = await supabase.rpc("tenant_announcements");
  const items = (data ?? []) as TenantAnnouncement[];
  if (error) console.error("tenant_announcements failed:", error.message);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Announcements</h1>
        <p className="text-[15px] text-slate-500">Updates from your landlord</p>
      </div>

      {error ? (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load announcements. Please refresh and try again.
        </p>
      ) : overview && !overview.has_lease ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Join a unit to see announcements from your landlord.
        </p>
      ) : (
        <AnnouncementsList userId={user.id} items={items} />
      )}
    </div>
  );
}
