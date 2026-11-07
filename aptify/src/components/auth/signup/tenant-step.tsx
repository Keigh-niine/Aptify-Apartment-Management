"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate, formatPeso, ordinal } from "@/lib/format";
import { inviteErrorMessage, type InvitePreview } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";
import { Field } from "../field";
import { StepIndicator } from "./wizard-parts";

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-[5px] text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right text-slate-900 ${bold ? "font-bold" : "font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}

function PreviewCard({ p }: { p: InvitePreview }) {
  const dueNow = p.security_deposit + p.advance_rent;
  const dueNowNote = [
    p.security_deposit > 0 ? `Security deposit ${formatPeso(p.security_deposit)}` : null,
    p.advance_rent > 0 ? `advance rent ${formatPeso(p.advance_rent)}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] border border-sky-200 bg-sky-50 p-5">
      <p className="text-xs font-semibold text-sky-700">You are joining</p>
      <p className="text-lg font-bold text-slate-900">
        {p.unit_label} · {p.property_name}
      </p>
      <p className="text-[13px] text-slate-500">
        {p.street_address}, {p.city}
      </p>

      <div className="mt-2">
        <Row label="Monthly rent" value={formatPeso(p.monthly_rent)} />
        <Row label="Due every" value={`${ordinal(p.due_day)} of the month`} />
        <Row label="Lease start" value={formatDate(p.start_date)} />
      </div>

      {p.charges.length > 0 && (
        <>
          <div className="my-1 h-px bg-slate-200" />
          <p className="text-[13px] font-semibold text-slate-900">Monthly charges</p>
          {p.charges.map((c) => (
            <Row
              key={c.name}
              label={c.name}
              value={
                c.mode === "fixed" && c.fixed_amount !== null
                  ? formatPeso(c.fixed_amount)
                  : "Varies each month"
              }
            />
          ))}
        </>
      )}

      {dueNow > 0 && (
        <>
          <div className="my-1 h-px bg-slate-200" />
          <Row label="Due when you join" value={formatPeso(dueNow)} bold />
          <p className="text-xs text-slate-500">{dueNowNote}.</p>
        </>
      )}
    </div>
  );
}

export function TenantStep({
  email,
  initialCode = "",
  onBack,
  onJoin,
}: {
  email: string;
  initialCode?: string;
  onBack: () => void;
  // Returns an error message, or null on success.
  onJoin: (code: string) => Promise<string | null>;
}) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);

  async function validate() {
    setError(null);
    setChecking(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("preview_invite", {
      p_code: code,
      p_email: email,
    });
    setChecking(false);

    if (rpcError || !data) {
      setError("Something went wrong. Please try again.");
      return;
    }
    if (!data.ok) {
      setError(inviteErrorMessage(String(data.error)));
      return;
    }
    setPreview(data as InvitePreview);
  }

  async function join() {
    setError(null);
    setJoining(true);
    const message = await onJoin(code);
    if (message) {
      setError(message);
      setPreview(null);
      setJoining(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview) join();
    else if (code.trim()) validate();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[464px] flex-col gap-5">
      <StepIndicator step={2} />

      <div className="flex flex-col gap-1.5">
        <h2 className="text-[32px] font-bold text-slate-900">Join a unit</h2>
        <p className="text-[15px] text-slate-500">Enter the invite code from your landlord.</p>
      </div>

      <Field
        label="Invite code"
        name="code"
        value={code}
        placeholder="APT-XXXX-XX"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        error={error ?? undefined}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
          setPreview(null);
          setError(null);
        }}
      />

      {preview && <PreviewCard p={preview} />}

      <div className="flex gap-2.5">
        <Button type="button" variant="outline" onClick={onBack} disabled={joining}>
          Back
        </Button>
        {preview ? (
          <Button type="submit" className="flex-1" disabled={joining}>
            {joining ? "Creating account…" : "Create account & join unit"}
          </Button>
        ) : (
          <Button type="submit" className="flex-1" disabled={checking || !code.trim()}>
            {checking ? "Checking…" : "Validate"}
          </Button>
        )}
      </div>

      <p className="flex justify-center gap-1.5 text-sm text-slate-500">
        Already have an account?
        <Link href="/login" className="font-semibold text-sky-700">
          Log in
        </Link>
      </p>
    </form>
  );
}
