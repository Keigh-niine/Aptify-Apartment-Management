"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// Creates this month's bills for every tenant who doesn't have one yet.
export function GenerateBillsButton({
  propertyId,
  month,
}: {
  propertyId: string;
  month: string; // first day of the month, YYYY-MM-DD
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function run() {
    setLoading(true);
    setMessage(null);
    const { data, error } = await createClient().rpc("generate_monthly_bills", {
      p_property: propertyId,
      p_month: month,
    });
    setLoading(false);

    if (error) {
      const missing = error.message.includes("generate_monthly_bills");
      setMessage({
        ok: false,
        text: missing
          ? "Run 011_monthly_bills.sql in Supabase first."
          : `Couldn't create bills (${error.message}).`,
      });
      return;
    }

    const n = Number(data ?? 0);
    setMessage({
      ok: true,
      text:
        n > 0
          ? `Created ${n} bill${n === 1 ? "" : "s"}.`
          : "No bills to create yet. Tenants who paid advance rent are billed from next month.",
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" onClick={run} disabled={loading}>
        {loading ? "Creating…" : "Generate bills"}
      </Button>
      {message && (
        <p className={`text-xs ${message.ok ? "text-slate-500" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
