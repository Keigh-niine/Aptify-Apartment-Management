import { MaintenanceBoard } from "@/components/landlord/maintenance/maintenance-board";
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

  if (error || !data) {
    body = (
      <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
        Couldn&apos;t load maintenance requests. Make sure you ran 005_landlord_maintenance.sql in
        Supabase.
        {error ? ` (${error.message})` : ""}
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

    const views: RequestView[] = requests.map((r) => ({
      ...r,
      photoUrls: r.photos.map((p) => urls.get(p)).filter((u): u is string => !!u),
    }));

    body = (
      <MaintenanceBoard
        requests={views}
        technicians={technicians}
        userId={user.id}
        propertyId={property.id}
        initialRequestId={request}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Maintenance</h1>
        <p className="text-[15px] text-slate-500">Review, assign, and update repair requests</p>
      </div>
      {body}
    </div>
  );
}
