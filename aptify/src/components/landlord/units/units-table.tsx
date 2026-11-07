import { ago } from "@/lib/landlord";
import { formatPeso } from "@/lib/format";
import { shortLabel } from "@/lib/signup";
import { expiresIn, rowKind, type RowKind, type UnitRow } from "@/lib/units";
import { RowActions } from "./row-actions";

const badge: Record<RowKind, { text: string; cls: string }> = {
  occupied: { text: "Occupied", cls: "bg-green-100 text-green-800" },
  pending: { text: "Invite pending", cls: "bg-amber-100 text-amber-800" },
  expired: { text: "Invite expired", cls: "bg-red-100 text-red-800" },
  vacant: { text: "Vacant", cls: "bg-slate-100 text-slate-700" },
};

const cols = "grid grid-cols-[90px_minmax(150px,200px)_110px_150px_minmax(150px,200px)_1fr] items-center gap-4";

export function UnitsTable({ rows }: { rows: UnitRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        This property has no units yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <div className="min-w-[900px]">
        <div className={`${cols} border-b border-slate-200 px-6 py-3 text-xs font-semibold text-slate-500`}>
          <span>Unit</span>
          <span>Tenant</span>
          <span>Rent</span>
          <span>Status</span>
          <span>Invite</span>
          <span />
        </div>

        {rows.map((r) => {
          const kind = rowKind(r);
          const b = badge[kind];

          const tenant =
            kind === "occupied" ? r.tenant_name : kind === "vacant" ? null : r.invitee_name;
          const inviteText =
            kind === "occupied"
              ? "Joined"
              : kind === "pending"
                ? expiresIn(r.expires_at!)
                : kind === "expired"
                  ? `Expired ${ago(r.expires_at!)}`
                  : "No active invite";

          return (
            <div
              key={r.unit_id}
              className={`${cols} border-b border-slate-100 px-6 py-3.5 text-sm last:border-b-0`}
            >
              <span className="font-semibold text-slate-900">{shortLabel(r.label)}</span>
              <span className={tenant ? "text-slate-900" : "text-slate-500"}>
                {tenant ?? "Not assigned"}
              </span>
              <span className="text-slate-900">
                {r.rent !== null ? formatPeso(Number(r.rent)).replace(/\.00$/, "") : "—"}
              </span>
              <span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.cls}`}>
                  {b.text}
                </span>
              </span>
              <span className="text-slate-500">{inviteText}</span>
              <span className="flex justify-end">
                <RowActions
                  kind={kind}
                  unitId={r.unit_id}
                  label={r.label}
                  tenantName={tenant}
                  leaseId={r.lease_id}
                  inviteId={r.invite_id}
                  code={r.code}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
