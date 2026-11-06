import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Loads the logged-in landlord and their property once per request.
// Layout and pages can both call it without repeating the queries.
export const getLandlordContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: properties }] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).single(),
    supabase
      .from("properties")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  const property = properties?.[0];
  if (!property) redirect("/dashboard");

  return { supabase, user, profile, property };
});

export type AttentionItem = {
  kind: "cash" | "repair" | "overdue";
  id: string;
  unit_label: string;
  person: string | null;
  amount: number | null;
  urgency: string | null;
  days_overdue: number | null;
  title: string | null;
  sort_at: string;
};

export type OverviewAnnouncement = {
  id: string;
  title: string;
  audience: "property" | "units";
  status: "draft" | "published";
  at: string;
  unit_count: number;
};

export type OverviewData = {
  rent_received_pct: number | null;
  pending_cash: number;
  open_repairs: number;
  vacant_units: number;
  attention: AttentionItem[];
  announcements: OverviewAnnouncement[];
};

export function ago(iso: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  const m = Math.floor(days / 30);
  return `${m} month${m === 1 ? "" : "s"} ago`;
}
