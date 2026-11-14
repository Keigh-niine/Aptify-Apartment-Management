import { AnnouncementsBoard } from "@/components/landlord/announcements/announcements-board";
import { getLandlordContext } from "@/lib/landlord";
import type { AnnouncementRow, UnitOption } from "@/lib/announcements";

export const instant = false;

export default async function AnnouncementsPage() {
  const { supabase, property } = await getLandlordContext();

  const [announcementsRes, unitsRes] = await Promise.all([
    supabase
      .from("announcements")
      .select(
        "id, title, body, audience, notify_email, status, published_at, created_at, announcement_units(unit_id)"
      )
      .eq("property_id", property.id),
    supabase.from("units").select("id, label").eq("property_id", property.id),
  ]);

  const items = ((announcementsRes.data ?? []) as AnnouncementRow[]).sort((a, b) =>
    (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at)
  );
  const units = ((unitsRes.data ?? []) as UnitOption[]).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true })
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Announcements</h1>
        <p className="text-[15px] text-slate-500">Post notices to a property or specific units</p>
      </div>

      {announcementsRes.error ? (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load announcements. ({announcementsRes.error.message})
        </p>
      ) : (
        <AnnouncementsBoard propertyId={property.id} items={items} units={units} />
      )}
    </div>
  );
}
