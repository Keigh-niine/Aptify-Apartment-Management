"use client";

import { useState } from "react";
import { Field } from "@/components/auth/field";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { SettingsCard } from "./settings-card";

type Errors = Partial<Record<"current" | "next", string>>;

export function PasswordCard({ email }: { email: string }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const found: Errors = {};
    if (!current) found.current = "Enter your current password.";
    if (next.length < 8) found.next = "At least 8 characters.";
    else if (next === current) found.next = "Choose a different password.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const supabase = createClient();

    // Check the current password first, so only the account owner can change it.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (verifyError) {
      setErrors({ current: "Current password is incorrect." });
      setSaving(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      if (error.code === "same_password") {
        setErrors({ next: "Choose a different password." });
      } else if (error.code === "weak_password") {
        setErrors({ next: "That password is too easy to guess." });
      } else {
        toast("err", "Something went wrong. Please try again.");
      }
      setSaving(false);
      return;
    }

    setCurrent("");
    setNext("");
    setSaving(false);
    toast("ok", "Password updated.");
  }

  return (
    <SettingsCard title="Change password">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[14px]">
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.current}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.next}
        />
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? "Updating…" : "Update password"}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
