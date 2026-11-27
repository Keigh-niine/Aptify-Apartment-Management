// What the "Edit lease" overlay loads from the database.
export type LeaseCharge = {
  id: string;
  name: string;
  category: "utility" | "fee" | "other";
  mode: "fixed" | "variable";
  fixed_amount: number | null;
};

export type LeaseDetails = {
  lease_id: string;
  status: "pending" | "active";
  unit_label: string;
  tenant_name: string | null;
  start_date: string;
  end_date: string | null;
  security_deposit: number;
  advance_rent: number;
  monthly_rent: number;
  due_day: number;
  has_current_bill: boolean; // this month's bill already exists, so a change cannot touch it
  charges: LeaseCharge[];
};