import { MaintenanceBoard } from "@/components/landlord/maintenance/maintenance-board";
import { StaffButton } from "@/components/landlord/maintenance/staff-dialog";
import { getLandlordContext } from "@/lib/landlord";
import type { MaintenanceRequest, RequestView, Technician } from "@/lib/maintenance";

export const instant = false;

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { supabase, user, property } = await getLandlordContext();
  const { request } = await searchParams;

  const { data, error } = await supabase.rpc("landlord_maintenance", { p_property: property.id });

  let body: React.ReactNode;
  let staffButton: React.ReactNode = null;

  if (error || !data) {
    if (error) console.error("landlord_maintenance failed:", error.message);
    body = (
      <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
        Couldn&apos;t load maintenance requests. Please refresh and try again.
      </p>
    );
  } else {
    const requests = (data.requests ?? []) as MaintenanceRequest[];
    const technicians = (data.technicians ?? []) as Technician[];

    // The photo bucket is private, so each photo needs a temporary link.
    const paths = requests.flatMap((r) => r.photos);
    const urls = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("maintenance-photos")
        .createSignedUrls(paths, 3600);
      signed?.forEach((s) => {
        if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      });
    }

    // How many unresolved requests each person is handling (shown in the Staff list)
    const openCounts: Record<string, number> = {};
    for (const r of requests) {
      if (r.status === "assigned" && r.technician_id) {
        openCounts[r.technician_id] = (openCounts[r.technician_id] ?? 0) + 1;
      }
    }
    staffButton = (
      <StaffButton staff={technicians} openCounts={openCounts} propertyId={property.id} />
    );

    const views: RequestView[] = requests.map((r) => ({
      ...r,
      photoUrls: r.photos.map((p) => urls.get(p)).filter((u): u is string => !!u),
    }));

    body = (
      <MaintenanceBoard
        requests={views}
        technicians={technicians}
        userId={user.id}
        initialRequestId={request}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">Maintenance</h1>
          <p className="text-[15px] text-slate-500">Review requests and assign staff</p>
        </div>
        {staffButton}
      </div>
      {body}
    </div>
  );
}