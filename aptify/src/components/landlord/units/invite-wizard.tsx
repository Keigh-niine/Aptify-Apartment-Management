"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatPeso } from "@/lib/format";
import {
  chargeProblems,
  dueDayLabel,
  firstBillDueISO,
  fmtMoney,
  newCharge,
  parseMoney,
  type ChargeDraft,
} from "@/lib/units";
import { ChargesEditor } from "./charges-editor";
import { inputClass, Labeled, MoneyInput, Panel, Toggle } from "./ui";
import { Stepper } from "./stepper";

export type VacantUnit = { id: string; label: string; listed_rent: number | null };

const stepLabels = ["Unit and tenant", "Lease and billing", "Review and share"];
const dueDays = Array.from({ length: 28 }, (_, i) => i + 1);

const outlineLink =
  "inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50";

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className={bold ? "font-semibold text-slate-900" : "text-slate-500"}>{label}</span>
      <span className={`text-right text-slate-900 ${bold ? "font-bold" : "font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}

export function InviteWizard({
  propertyName,
  units,
  initialUnitId,
  defaultStart,
}: {
  propertyName: string;
  units: VacantUnit[];
  initialUnitId: string;
  defaultStart: string; // YYYY-MM-DD
}) {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [unitId, setUnitId] = useState(initialUnitId);
  const [tenantName, setTenantName] = useState("");
  const [tenantEmail, setTenantEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  // Step 2
  const [start, setStart] = useState(defaultStart);
  const [rent, setRent] = useState(() => {
    const u = units.find((x) => x.id === initialUnitId);
    return u?.listed_rent ? fmtMoney(Number(u.listed_rent)) : "";
  });
  const [rentTouched, setRentTouched] = useState(false);
  const [dueDay, setDueDay] = useState(5);
  const [charges, setCharges] = useState<ChargeDraft[]>(() => [
    newCharge("Association dues", "fixed"),
    newCharge("Electricity", "variable"),
    newCharge("Water", "variable"),
  ]);
  const [moveIn, setMoveIn] = useState(true);
  const [depositInput, setDepositInput] = useState<string | null>(null);
  const [advanceInput, setAdvanceInput] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  // Step 3
  const [result, setResult] = useState<{ code: string; expires_at: string } | null>(null);

  const unit = units.find((u) => u.id === unitId);

  const rentNum = parseMoney(rent);
  const depositStr = depositInput ?? rent;
  const advanceStr = advanceInput ?? rent;
  const depositNum = moveIn ? parseMoney(depositStr) : 0;
  const advanceNum = moveIn ? parseMoney(advanceStr) : 0;
  const startValid = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const problems = chargeProblems(charges);

  const leaseValid =
    startValid &&
    rentNum !== null &&
    rentNum > 0 &&
    problems.size === 0 &&
    depositNum !== null &&
    advanceNum !== null;

  const fixedCharges = charges.filter((c) => c.mode === "fixed");
  const fixedTotal =
    (rentNum ?? 0) + fixedCharges.reduce((sum, c) => sum + (parseMoney(c.amount) ?? 0), 0);
  const moveInTotal = (depositNum ?? 0) + (advanceNum ?? 0);
  const firstDue = startValid ? firstBillDueISO(start, dueDay, (advanceNum ?? 0) > 0) : null;

  function chooseUnit(id: string) {
    setUnitId(id);
    if (!rentTouched) {
      const u = units.find((x) => x.id === id);
      setRent(u?.listed_rent ? fmtMoney(Number(u.listed_rent)) : "");
    }
  }

  function nextFromUnit() {
    if (tenantEmail.trim() && !/^\S+@\S+\.\S+$/.test(tenantEmail.trim())) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setStep(2);
  }

  async function createInvite() {
    setShowErrors(true);
    if (!leaseValid) return;

    setSaving(true);
    const { data, error } = await createClient().rpc("create_lease_with_invite", {
      p_unit: unitId,
      p_start: start,
      p_monthly_rent: rentNum,
      p_due_day: dueDay,
      p_security_deposit: depositNum ?? 0,
      p_advance_rent: advanceNum ?? 0,
      p_charges: charges.map((c) => ({
        name: c.name.trim(),
        category: c.mode === "variable" ? "utility" : "fee",
        mode: c.mode,
        fixed_amount: c.mode === "fixed" ? parseMoney(c.amount) : null,
      })),
      p_invitee_name: tenantName.trim() || null,
      p_invitee_email: tenantEmail.trim() || null,
    });
    setSaving(false);

    if (error || !data) {
      if (error?.message.includes("unit_not_vacant")) {
        toast("err", "That unit already has a tenant or a pending invite.");
        setStep(1);
      } else {
        toast("err", "Something went wrong. Please try again.");
      }
      return;
    }

    setResult({ code: data.code, expires_at: data.expires_at });
    setStep(3);
  }

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("info", message);
    } catch {
      toast("err", "Couldn't copy. Select the text and copy it yourself.");
    }
  }

  const inviteLink = (code: string) =>
    `${window.location.origin}/signup?role=tenant&code=${encodeURIComponent(code)}`;

  const heading =
    step === 1
      ? { title: "Add Tenant", sub: "Choose a vacant unit and invite its tenant" }
      : step === 2
        ? { title: "Lease and billing", sub: "Set the terms once. Monthly bills are created from these." }
        : { title: "Invite created", sub: "Share the code with your tenant. It works once and expires in 7 days." };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">{heading.title}</h1>
        <p className="text-[15px] text-slate-500">{heading.sub}</p>
      </div>

      <Stepper steps={stepLabels} current={step === 3 ? 4 : step} />

      {/* ---------- Step 1: unit and tenant ---------- */}
      {step === 1 && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Panel title="Unit and tenant" className="flex-1">
            <Labeled label="Unit" hint="Only vacant units are listed.">
              <select
                value={unitId}
                onChange={(e) => chooseUnit(e.target.value)}
                className={inputClass()}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Labeled>

            <Labeled label="Tenant name (optional)">
              <input
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="e.g. Ana Reyes"
                className={inputClass()}
              />
            </Labeled>

            <Labeled
              label="Tenant email (optional)"
              hint="If you add an email, only that email can use the code."
              error={emailError ?? undefined}
            >
              <input
                type="email"
                value={tenantEmail}
                onChange={(e) => setTenantEmail(e.target.value)}
                placeholder="e.g. ana@email.com"
                className={inputClass(!!emailError)}
              />
            </Labeled>

            <div className="flex gap-2.5">
              <Link href="/landlord/units" className={outlineLink}>
                Cancel
              </Link>
              <Button type="button" onClick={nextFromUnit}>
                Next: Lease and billing
              </Button>
            </div>
          </Panel>

          <Panel title="How invites work" className="w-full lg:w-[340px] lg:shrink-0">
            {[
              ["One code, one tenant", "Each code works once and expires after 7 days."],
              ["You set the billing terms", "Rent and recurring charges are set once, in the next step."],
              ["Joining creates the lease", "The tenant joins the unit and gets the first bill automatically."],
            ].map(([t, d]) => (
              <div key={t} className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-slate-900">{t}</p>
                <p className="text-xs text-slate-500">{d}</p>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ---------- Step 2: lease and billing ---------- */}
      {step === 2 && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Panel title="Lease" className="flex-1 gap-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Labeled label="Lease start" error={showErrors && !startValid ? "Pick a date." : undefined}>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className={inputClass(showErrors && !startValid)}
                />
              </Labeled>
              <Labeled
                label="Monthly rent"
                error={showErrors && (rentNum === null || rentNum <= 0) ? "Enter the rent." : undefined}
              >
                <MoneyInput
                  label="Monthly rent"
                  value={rent}
                  placeholder="0.00"
                  invalid={showErrors && (rentNum === null || rentNum <= 0)}
                  onChange={(v) => {
                    setRent(v);
                    setRentTouched(true);
                  }}
                />
              </Labeled>
              <Labeled label="Due day">
                <select
                  value={dueDay}
                  onChange={(e) => setDueDay(Number(e.target.value))}
                  className={inputClass()}
                >
                  {dueDays.map((d) => (
                    <option key={d} value={d}>
                      {dueDayLabel(d)}
                    </option>
                  ))}
                </select>
              </Labeled>
            </div>

            <div className="h-px bg-slate-200" />

            <ChargesEditor charges={charges} onChange={setCharges} showErrors={showErrors} />

            <div className="h-px bg-slate-200" />

            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-base font-bold text-slate-900">Move-in charges</p>
                <p className="text-xs text-slate-500">
                  Security deposit and advance rent, billed once as a separate bill
                </p>
              </div>
              <Toggle checked={moveIn} onChange={setMoveIn} label="Move-in charges" />
            </div>

            {moveIn && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled
                  label="Security deposit"
                  error={showErrors && depositNum === null ? "Enter an amount." : undefined}
                >
                  <MoneyInput
                    label="Security deposit"
                    value={depositStr}
                    placeholder="0.00"
                    invalid={showErrors && depositNum === null}
                    onChange={setDepositInput}
                  />
                </Labeled>
                <Labeled
                  label="Advance rent"
                  error={showErrors && advanceNum === null ? "Enter an amount." : undefined}
                >
                  <MoneyInput
                    label="Advance rent"
                    value={advanceStr}
                    placeholder="0.00"
                    invalid={showErrors && advanceNum === null}
                    onChange={setAdvanceInput}
                  />
                </Labeled>
              </div>
            )}

            <div className="flex gap-2.5">
              <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={saving}>
                Back
              </Button>
              <Button type="button" onClick={createInvite} disabled={saving}>
                {saving ? "Creating invite…" : "Next: Review"}
              </Button>
            </div>
          </Panel>

          <Panel title="First monthly bill" className="w-full gap-1 lg:w-[340px] lg:shrink-0">
            <p className="-mt-2 mb-2 text-xs text-slate-500">
              {firstDue ? `Due ${formatDate(firstDue)}` : "Pick a lease start date"}
            </p>
            <Row label="Monthly rent" value={formatPeso(rentNum ?? 0)} />
            {charges
              .filter((c) => c.name.trim())
              .map((c) => (
                <Row
                  key={c.id}
                  label={c.name.trim()}
                  value={
                    c.mode === "fixed" ? formatPeso(parseMoney(c.amount) ?? 0) : "Varies each month"
                  }
                />
              ))}
            <div className="my-1.5 h-px bg-slate-200" />
            <Row label="Fixed total" value={formatPeso(fixedTotal)} bold />
            <p className="text-xs text-slate-500">
              Variable charges are added when you enter them each month.
            </p>

            {moveIn && (
              <>
                <div className="my-1.5 h-px bg-slate-200" />
                <p className="text-[13px] font-semibold text-slate-900">Move-in bill</p>
                <Row label="Security deposit" value={formatPeso(depositNum ?? 0)} />
                <Row label="Advance rent" value={formatPeso(advanceNum ?? 0)} />
                <Row label="Total due on joining" value={formatPeso(moveInTotal)} bold />
              </>
            )}
          </Panel>
        </div>
      )}

      {/* ---------- Step 3: review and share ---------- */}
      {step === 3 && result && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Panel title="Invite summary" className="flex-1 gap-2">
            <Row label="Unit" value={`${unit?.label} · ${propertyName}`} />
            <Row
              label="Tenant"
              value={
                tenantName.trim() || tenantEmail.trim()
                  ? [tenantName.trim(), tenantEmail.trim() && `(${tenantEmail.trim()})`]
                      .filter(Boolean)
                      .join(" ")
                  : "Not specified (anyone with the code)"
              }
            />
            <Row label="Lease start" value={formatDate(start)} />
            <Row label="Monthly rent" value={formatPeso(rentNum ?? 0)} />
            <Row label="Due day" value={dueDayLabel(dueDay)} />
            <Row
              label="Recurring charges"
              value={charges.map((c) => c.name.trim()).filter(Boolean).join(", ") || "None"}
            />
            <Row
              label="Move-in charges"
              value={moveIn ? `${formatPeso(moveInTotal)} (deposit and advance)` : "None"}
            />
            <div className="mt-3 flex gap-2.5">
              <Button type="button" onClick={() => { router.push("/landlord/units"); router.refresh(); }}>
                Done
              </Button>
            </div>
          </Panel>

          <Panel title="Invite code" className="w-full lg:w-[340px] lg:shrink-0">
            <div className="rounded-xl bg-sky-50 px-4 py-5 text-center">
              <p className="text-[28px] font-bold tracking-wider text-sky-700">{result.code}</p>
            </div>
            <span className="self-start rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              Expires {formatDate(result.expires_at.slice(0, 10))}
            </span>
            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" onClick={() => copy(result.code, "Invite code copied.")}>
                Copy code
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => copy(inviteLink(result.code), "Invite link copied.")}
              >
                Copy invite link
              </Button>
              <a
                className={outlineLink}
                href={`mailto:${encodeURIComponent(tenantEmail.trim())}?subject=${encodeURIComponent(
                  `Your invite to ${unit?.label} at ${propertyName}`
                )}&body=${encodeURIComponent(
                  `Hi${tenantName.trim() ? ` ${tenantName.trim()}` : ""},\n\nYou're invited to join ${unit?.label} at ${propertyName} on Aptify.\n\nInvite code: ${result.code}\nSign up here: ${inviteLink(result.code)}\n\nThe code works once and expires on ${formatDate(result.expires_at.slice(0, 10))}.`
                )}`}
              >
                Send by email
              </a>
            </div>
            <p className="text-xs text-slate-500">
              Need to cancel it? Revoke the invite from the Units and invites table.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
