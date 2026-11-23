"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/auth/field";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { SettingsCard } from "./settings-card";

type Values = { firstName: string; lastName: string; phone: string };
type Errors = Partial<Record<keyof Values, string>>;

export function ProfileCard({
  userId,
  email,
  initial,
}: {
  userId: string;
  email: string;
  initial: Values;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const next: Errors = {};
    const phone = form.phone.trim();
    if (!form.firstName.trim()) next.firstName = "Enter your first name.";
    if (!form.lastName.trim()) next.lastName = "Enter your last name.";
    if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) next.phone = "Enter a valid phone number.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        phone: phone || null,
      })
      .eq("id", userId);

    if (error) {
      toast("err", "Something went wrong. Please try again.");
      setSaving(false);
      return;
    }

    toast("ok", "Profile saved.");
    setSaving(false);
    router.refresh(); // updates the name shown in the sidebar
  }

  return (
    <SettingsCard title="Profile">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[14px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="First name"
            autoComplete="given-name"
            value={form.firstName}
            onChange={set("firstName")}
            error={errors.firstName}
          />
          <Field
            label="Last name"
            autoComplete="family-name"
            value={form.lastName}
            onChange={set("lastName")}
            error={errors.lastName}
          />
        </div>
        <Field
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          readOnly
          disabled
          hint="Your email is used to sign in and can't be changed here."
        />
        <Field
          label="Phone number"
          type="tel"
          autoComplete="tel"
          placeholder="0917 123 4567"
          value={form.phone}
          onChange={set("phone")}
          error={errors.phone}
        />
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
