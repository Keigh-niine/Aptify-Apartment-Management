import { ago } from "@/lib/time";
import { formatPeso } from "@/lib/format";
import { shortLabel } from "@/lib/signup";
import { expiresIn, rowKind, type RowKind, type UnitRow } from "@/lib/units";
import { CopyCode } from "./copy-code";
import { RowActions } from "./row-actions";

const badge: Record<RowKind, { text: string; cls: string }> = {
  occupied: { text: "Occupied", cls: "bg-green-100 text-green-800" },
  pending: { text: "Invite pending", cls: "bg-amber-100 text-amber-800" },
  expired: { text: "Invite expired", cls: "bg-red-100 text-red-800" },
  vacant: { text: "Vacant", cls: "bg-slate-100 text-slate-700" },
};

const cols =
  "grid grid-cols-[90px_minmax(140px,180px)_minmax(180px,240px)_100px_140px_minmax(130px,170px)_1fr] items-center gap-4";

function Contact({
  email,
  phone,
  showPhone,
}: {
  email: string | null;
  phone: string | null;
  showPhone: boolean;
}) {
  if (!email && !phone) return <span className="text-slate-500">{showPhone ? "No contact info" : "—"}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {email && (
        <a href={`mailto:${email}`} title={email} className="truncate text-slate-900 hover:underline">
          {email}
        </a>
      )}
      {showPhone &&
        (phone ? (
          <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className="truncate text-slate-500 hover:underline">
            {phone}
          </a>
        ) : (
          <span className="text-slate-400">No phone number</span>
        ))}
    </span>
  );
}

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
      <div className="min-w-[1200px]">
        <div className={`${cols} border-b border-slate-200 px-6 py-3 text-xs font-semibold text-slate-500`}>
          <span>Unit</span>
          <span>Tenant</span>
          <span>Contact</span>
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
              <Contact
                email={kind === "occupied" ? r.tenant_email : r.invitee_email}
                phone={kind === "occupied" ? r.tenant_phone : null}
                showPhone={kind === "occupied"}
              />
              <span className="text-slate-900">
                {r.rent !== null ? formatPeso(Number(r.rent)).replace(/\.00$/, "") : "—"}
              </span>
              <span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${b.cls}`}>
                  {b.text}
                </span>
              </span>
              <span className="flex flex-col items-start gap-1">
                <span className="text-slate-500">{inviteText}</span>
                {kind === "pending" && r.code && <CopyCode code={r.code} />}
              </span>
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