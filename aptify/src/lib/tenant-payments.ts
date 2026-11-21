export type PayMethod = "cash" | "gcash" | "maya";
export type PaymentStatus = "pending" | "confirmed" | "rejected";

export type CurrentBill = {
  bill_id: string;
  bill_type: "monthly" | "move_in";
  billing_period: string;
  due_date: string;
  total_due: number;
  paid: number;
  balance: number;
  item_names: string[];
  pending: { payment_id: string; amount: number; method: PayMethod; created_at: string } | null;
  rejected: {
    reason: "not_received" | "wrong_amount" | "other";
    message: string | null;
    amount: number;
    method: PayMethod;
  } | null;
};

export type HistoryRow = {
  id: string;
  billing_period: string;
  bill_type: "monthly" | "move_in";
  amount: number;
  method: PayMethod;
  status: PaymentStatus;
  created_at: string;
  receipt_no: string | null;
};

export type PaymentsData =
  | { has_lease: false }
  | {
      has_lease: true;
      unit_label: string;
      property_name: string;
      current_bill: CurrentBill | null;
      history: HistoryRow[];
    };

export type PayBill = {
  bill_id: string;
  bill_type: "monthly" | "move_in";
  billing_period: string;
  due_date: string;
  discount: number;
  items: { description: string; amount: number }[];
  total_due: number;
  paid: number;
  balance: number;
  has_pending: boolean;
};

export type PayAccount = {
  method: "gcash" | "maya";
  account_name: string;
  account_number: string;
  qr_path: string | null;
  qr_url?: string | null; // temporary link to the private QR image
};

export type PayInfo =
  | { has_bill: false }
  | {
      has_bill: true;
      unit_label: string;
      property_name: string;
      bill: PayBill;
      accounts: PayAccount[];
    };

export type ReceiptData = {
  receipt_no: string;
  issued_at: string;
  tenant_name: string;
  unit_label: string;
  property_name: string;
  date_paid: string;
  billing_period: string;
  method: PayMethod;
  reference_no: string | null;
  items: { description: string; amount: number }[];
  total_paid: number;
  balance: number;
};

export const providerLabel: Record<string, string> = { gcash: "GCash", maya: "Maya", cash: "Cash" };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Receipt screenshots: private bucket "payment-receipts", path {tenant_id}/{timestamp}.{ext}
export const RECEIPT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
