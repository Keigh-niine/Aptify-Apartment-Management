export type Method = "cash" | "gcash" | "maya";
export type LedgerStatus = "paid" | "pending" | "overdue" | "partial" | "unpaid";

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

export type LedgerRow = {
  bill_id: string;
  bill_type: "monthly" | "move_in";
  billing_period: string;
  due_date: string;
  tenant_name: string;
  unit_label: string;
  total_due: number;
  paid: number;
  balance: number;
  status: LedgerStatus;
  method: string | null;
  amount: number;
  pending: PendingPayment | null;
};

export type LedgerData = {
  month: string;
  rows: LedgerRow[];
  rent_received_pct: number | null;
  pending_count: number;
  open_repairs: number;
  next_receipt_year: number;
  next_receipt_number: number;
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

// Today's date in the browser's timezone, as YYYY-MM-DD
export function todayLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
