// What the "Create bills" screen shows: the tenants who still need this month's bill.
export type PreviewCharge = {
  charge_id: string;
  name: string;
  category: string;
  amount?: number; // only fixed charges have an amount
};

export type PreviewBill = {
  lease_id: string;
  tenant_name: string;
  unit_label: string;
  due_date: string;
  rent: number;
  fixed: PreviewCharge[]; // set in the lease, read-only here
  variable: PreviewCharge[]; // the landlord types the amount
};

export type BillPreview = {
  month: string; // first day of the month, YYYY-MM-DD
  bills: PreviewBill[];
};