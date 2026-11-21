import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Loads the logged-in tenant and their home data once per request.
// Layout and pages can both call it without repeating the queries.
export const getTenantContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, overviewRes] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    supabase.rpc("tenant_overview"),
  ]);

  return {
    supabase,
    user,
    profile,
    overview: (overviewRes.data ?? null) as TenantOverview | null,
    overviewError: overviewRes.error?.message ?? null,
  };
});

export type TenantPending = {
  payment_id: string;
  amount: number;
  method: "cash" | "gcash" | "maya";
  created_at: string;
};

export type TenantRejected = {
  reason: "not_received" | "wrong_amount" | "other";
  message: string | null;
  amount: number;
  method: "cash" | "gcash" | "maya";
};

export type TenantBill = {
  bill_id: string;
  bill_type: "monthly" | "move_in";
  billing_period: string;
  due_date: string;
  total_due: number;
  paid: number;
  balance: number;
  pending: TenantPending | null;
  rejected: TenantRejected | null;
};

export type TenantOverview =
  | { has_lease: false }
  | {
      has_lease: true;
      unit_label: string;
      property_name: string;
      current_bill: TenantBill | null;
      history: {
        id: string;
        billing_period: string;
        bill_type: "monthly" | "move_in";
        amount: number;
        method: "cash" | "gcash" | "maya";
        status: "pending" | "confirmed" | "rejected";
        created_at: string;
      }[];
      requests: {
        id: string;
        title: string;
        category: string;
        urgency: "urgent" | "medium" | "low";
        status: "new" | "assigned" | "resolved";
        created_at: string;
      }[];
      announcements: { id: string; title: string; published_at: string }[];
    };

// Whole days from today until a YYYY-MM-DD date. Negative means it is overdue.
export function daysUntil(iso: string) {
  const t = new Date();
  const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((Date.parse(iso + "T00:00:00Z") - today) / 86_400_000);
}

export const rejectionText: Record<string, string> = {
  not_received: "Your landlord did not receive the money.",
  wrong_amount: "The amount was different from what you owe.",
  other: "",
};
