import Link from "next/link";
import { LocalTime } from "@/components/tenant/maintenance/local-time";
import { SiteButton } from "@/components/site-button";
import { getTenantContext } from "@/lib/tenant";
import { cap, statusChip, type RequestRow } from "@/lib/tenant-maintenance";

export const instant = false;

const tabClass = (on: boolean) =>
  `rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold ${
    on
      ? "border-sky-700 bg-sky-700 text-white"
      : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
  }`;

export default async function TenantMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { supabase, user, overview } = await getTenantContext();
  const { tab } = await searchParams;
  const active = tab === "open" || tab === "resolved" ? tab : "all";

  const hasUnit = !!overview?.has_lease;

  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("id, title, category, urgency, status, created_at")
    .eq("requested_by", user.id)
    .order("created_at", { ascending: false });

  const all = (data ?? []) as RequestRow[];
  const open = all.filter((r) => r.status !== "resolved");
  const resolved = all.filter((r) => r.status === "resolved");
  const shown = active === "open" ? open : active === "resolved" ? resolved : all;

  const tabs = [
    { key: "all", href: "/tenant/maintenance", label: `All (${all.length})` },
    { key: "open", href: "/tenant/maintenance?tab=open", label: `Open (${open.length})` },
    { key: "resolved", href: "/tenant/maintenance?tab=resolved", label: `Resolved (${resolved.length})` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">Maintenance</h1>
          <p className="text-[15px] text-slate-500">
            {overview?.has_lease
              ? `Your repair requests for ${overview.unit_label}`
              : "Your repair requests"}
          </p>
        </div>
        {hasUnit && <SiteButton href="/tenant/maintenance/new">+ Request repair</SiteButton>}
      </div>

      {error && (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Couldn&apos;t load your requests. ({error.message})
        </p>
      )}

      {!hasUnit ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Join a unit to send repair requests to your landlord.
        </p>
      ) : all.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-lg font-bold text-slate-900">No repair requests yet</p>
          <p className="max-w-md text-sm text-slate-500">
            When something needs fixing, send a request and follow its progress here.
          </p>
          <div className="mt-2">
            <SiteButton href="/tenant/maintenance/new">Request repair</SiteButton>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <Link key={t.key} href={t.href} className={tabClass(active === t.key)}>
                {t.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
            {shown.length === 0 && (
              <p className="p-4 text-sm text-slate-500">Nothing in this list.</p>
            )}
            {shown.map((r) => {
              const chip = statusChip[r.status];
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3.5"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-sm font-semibold text-slate-900">{r.title}</p>
                    <p className="text-xs text-slate-500">
                      {cap(r.category)} · {cap(r.urgency)} · Submitted{" "}
                      <LocalTime iso={r.created_at} options={{ month: "short", day: "numeric" }} />
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip.cls}`}>
                      {chip.text}
                    </span>
                    <Link
                      href={`/tenant/maintenance/${r.id}`}
                      className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
