import { ordinal } from "./format";

export type UnitRow = {
  unit_id: string;
  label: string;
  listed_rent: number | null;
  lease_id: string | null;
  lease_status: "pending" | "active" | null;
  tenant_name: string | null;
  rent: number | null;
  invite_id: string | null;
  code: string | null;
  expires_at: string | null;
  invitee_name: string | null;
};

export type RowKind = "occupied" | "pending" | "expired" | "vacant";

export function rowKind(r: UnitRow): RowKind {
  if (r.lease_status === "active") return "occupied";
  if (r.lease_status === "pending" && r.invite_id && r.expires_at) {
    return new Date(r.expires_at).getTime() < Date.now() ? "expired" : "pending";
  }
  return "vacant";
}

export function sortRows(rows: UnitRow[]): UnitRow[] {
  return [...rows].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function expiresIn(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / 86_400_000);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

// "4,800.00" or "₱ 4,800" -> 4800. Returns null if it is not a valid amount.
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function fmtMoney(n: number) {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const dueDayLabel = (d: number) => `${ordinal(d)} of the month`;

// The first monthly bill is due the month after the lease starts when advance
// rent is collected (the advance covers the first month). Otherwise it is the start month.
export function firstBillDueISO(startISO: string, dueDay: number, hasAdvance: boolean) {
  const [y, m] = startISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + (hasAdvance ? 1 : 0), dueDay));
  return d.toISOString().slice(0, 10);
}

export type ChargeDraft = {
  id: number;
  name: string;
  mode: "fixed" | "variable";
  amount: string;
};

let chargeCounter = 0;
export const newCharge = (name = "", mode: "fixed" | "variable" = "fixed"): ChargeDraft => ({
  id: ++chargeCounter,
  name,
  mode,
  amount: "",
});

// Ids of charges that are incomplete or have a duplicate name.
export function chargeProblems(charges: ChargeDraft[]): Set<number> {
  const counts = new Map<string, number>();
  charges.forEach((c) => {
    const k = c.name.trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const bad = new Set<number>();
  charges.forEach((c) => {
    const k = c.name.trim().toLowerCase();
    if (k === "" || (counts.get(k) ?? 0) > 1) bad.add(c.id);
    if (c.mode === "fixed" && parseMoney(c.amount) === null) bad.add(c.id);
  });
  return bad;
}
