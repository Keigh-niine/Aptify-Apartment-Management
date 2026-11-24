import { manilaToday } from "@/lib/dates";
export type Method = "cash" | "gcash" | "maya";
export type BillLedgerStatus = "paid" | "pending" | "overdue" | "partial" | "unpaid";
export type LedgerStatus = BillLedgerStatus | "unbilled";

export type PendingPayment = {
  payment_id: string;
  amount: number;
  method: Method;
  reference_no: string | null;
  note: string | null;
  planned_date: string | null;
  receipt_path: string | null;
  created_at: string;
  receipt_url?: string | null; // a temporary link to the private receipt image
};

type LedgerTenant = {
  lease_id: string;
  tenant_name: string;
  unit_label: string;
};

export type BillLedgerRow = LedgerTenant & {
  status: BillLedgerStatus;
  bill_id: string;
  bill_type: "monthly" | "move_in";
  billing_period: string;
  due_date: string;
  total_due: number;
  paid: number;
  balance: number;
  method: string | null;
  amount: number;
  paid_on: string | null; // date the last confirmed payment was received
  pending: PendingPayment | null;
};

export type UnbilledLedgerRow = LedgerTenant & {
  status: "unbilled";
  bill_id: null;
  bill_type: null;
  billing_period: null;
  due_date: null;
  total_due: null;
  paid: null;
  balance: null;
  method: null;
  amount: null;
  paid_on: null;
  starts_on: string | null; // set when the lease has not started yet
  pending: null;
};

export type LedgerRow = BillLedgerRow | UnbilledLedgerRow;

export type LedgerData = {
  month: string;
  rows: LedgerRow[];
  rent_received_pct: number | null;
  pending_count: number;
  open_repairs: number;
  next_receipt_year: number;
  next_receipt_number: number;
};

export type ReceiptRecord = {
  id: string;
  receipt_no: string;
  issued_at: string;
  tenant_name: string;
  tenant_email: string | null;
  unit_label: string;
  bill_type: "monthly" | "move_in";
  billing_period: string;
  amount: number;
  method: Method;
  reference_no: string | null;
  received_on: string;
  pay_status: "fully_paid" | "partial" | "paid_overdue";
};

export const receiptStatus: Record<ReceiptRecord["pay_status"], { text: string; cls: string }> = {
  fully_paid: { text: "Fully paid", cls: "bg-green-100 text-green-800" },
  partial: { text: "Partial", cls: "bg-sky-100 text-sky-700" },
  paid_overdue: { text: "Paid overdue", cls: "bg-amber-100 text-amber-800" },
};

export const methodLabel: Record<string, string> = { cash: "Cash", gcash: "GCash", maya: "Maya" };

export function statusBadge(r: LedgerRow): { text: string; cls: string } {
  switch (r.status) {
    case "paid":
      return { text: "Paid", cls: "bg-green-100 text-green-800" };
    case "pending":
      return {
        text: r.pending?.method === "cash" ? "Pending cash" : "Pending",
        cls: "bg-amber-100 text-amber-800",
      };
    case "overdue":
      return { text: "Overdue", cls: "bg-red-100 text-red-800" };
    case "partial":
      return { text: "Partial", cls: "bg-sky-100 text-sky-700" };
    case "unbilled":
      return r.starts_on
        ? { text: `Starts ${shortDate(r.starts_on)}`, cls: "bg-slate-100 text-slate-700" }
        : { text: "Not billed", cls: "bg-slate-100 text-slate-700" };
    default:
      return { text: "Unpaid", cls: "bg-slate-100 text-slate-700" };
  }
}

// Pending first, then overdue, partial, unpaid, and paid last
export const statusRank: Record<LedgerStatus, number> = {
  pending: 0,
  overdue: 1,
  partial: 2,
  unpaid: 3,
  paid: 4,
  unbilled: 5,
};

export const receiptNo = (year: number, n: number) =>
  `OR-${year}-${String(n).padStart(4, "0")}`;

// "November 2026" from "2026-11-01"
export function monthTitle(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "Nov 12" from "2026-11-12"
export function shortDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// "11-12-2026" (MM-DD-YYYY) from "2026-11-12"
export function numericDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
}

// "Nov 12, 2026" from "2026-11-12"
export function dateWithYear(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Today's date in Philippine time, as YYYY-MM-DD
export function todayLocal() {
  return manilaToday();
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}