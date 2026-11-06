"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";
import { SettingsCard } from "./settings-card";
import { Toggle } from "./toggle";

export type Prefs = {
  rent_reminders: boolean;
  repair_updates: boolean;
  announcements: boolean;
};

const rows: Record<"landlord" | "tenant", { key: keyof Prefs; title: string; sub: string }[]> = {
  landlord: [
    { key: "rent_reminders", title: "Rent reminders", sub: "When rent is due or overdue" },
    { key: "repair_updates", title: "Repair updates", sub: "When a request is submitted or changes status" },
    { key: "announcements", title: "Announcements", sub: "When a notice is posted at your property" },
  ],
  tenant: [
    { key: "rent_reminders", title: "Rent reminders", sub: "Before a bill is due" },
    { key: "repair_updates", title: "Repair updates", sub: "When a request changes status" },
    { key: "announcements", title: "Announcements", sub: "When your landlord posts a notice" },
  ],
};

export function NotificationsCard({
  userId,
  initial,
  role,
}: {
  userId: string;
  initial: Prefs;
  role: "landlord" | "tenant";
}) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs>(initial);

  // Saves as soon as a switch is flipped. Undoes the switch if saving fails.
  async function change(key: keyof Prefs, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);

    const { error } = await createClient()
      .from("notification_preferences")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" });

    if (error) {
      setPrefs(previous);
      toast("err", "Something went wrong. Please try again.");
    }
  }

  return (
    <SettingsCard title="Email notifications">
      {rows[role].map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-slate-900">{r.title}</p>
            <p className="text-xs text-slate-500">{r.sub}</p>
          </div>
          <Toggle checked={prefs[r.key]} onChange={(v) => change(r.key, v)} label={r.title} />
        </div>
      ))}
    </SettingsCard>
  );
}
