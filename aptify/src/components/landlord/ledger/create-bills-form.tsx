"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoneyInput, Toggle } from "@/components/landlord/units/ui";
import { Button } from "@/components/ui/button";
import type { BillPreview, PreviewBill } from "@/lib/bill-preview";
import { formatPeso } from "@/lib/format";
import { monthTitle, numericDate } from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";
import { parseMoney } from "@/lib/units";

const keyOf = (name: string) => name.trim().toLowerCase();

const pill = "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold";
const fixedPill = `${pill} bg-slate-100 text-slate-600`;
const variablePill = `${pill} bg-sky-100 text-sky-700`;

export function CreateBillsForm({
  preview,
  propertyId,
}: {
  preview: BillPreview;
  propertyId: string;
}) {
  const router = useRouter();
  const [everyone, setEveryone] = useState<Record<string, boolean>>({}); // charge -> same for everyone? (default yes)
  const [common, setCommon] = useState<Record<string, string>>({}); // charge -> the amount for everyone
  const [each, setEach] = useState<Record<string, string>>({}); // "lease|charge" -> that tenant's amount
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bills = preview.bills;

  // The variable charges that exist on these leases (Water, Electricity, ...), one entry per name
  const groups: { key: string; name: string; count: number }[] = [];
  for (const b of bills) {
    for (const v of b.variable) {
      const key = keyOf(v.name);
      const g = groups.find((x) => x.key === key);
      if (g) g.count += 1;
      else groups.push({ key, name: v.name, count: 1 });
    }
  }

  const isEveryone = (key: string) => everyone[key] ?? true;

  function amountFor(leaseId: string, key: string) {
    const raw = isEveryone(key) ? (common[key] ?? "") : (each[`${leaseId}|${key}`] ?? "");
    const n = parseMoney(raw);
    return n !== null && n > 0 ? n : 0;
  }

  function totalFor(b: PreviewBill) {
    return (
      Number(b.rent) +
      b.fixed.reduce((sum, f) => sum + Number(f.amount ?? 0), 0) +
      b.variable.reduce((sum, v) => sum + amountFor(b.lease_id, keyOf(v.name)), 0)
    );
  }

  const grandTotal = bills.reduce((sum, b) => sum + totalFor(b), 0);

  async function submit() {
    setSaving(true);
    setError(null);

    const entries = bills.map((b) => ({
      lease_id: b.lease_id,
      variables: b.variable
        .map((v) => ({ charge_id: v.charge_id, amount: amountFor(b.lease_id, keyOf(v.name)) }))
        .filter((v) => v.amount > 0),
    }));

    const { error: rpcError } = await createClient().rpc("create_monthly_bills", {
      p_property: propertyId,
      p_month: preview.month,
      p_entries: entries,
    });
    setSaving(false);

    if (rpcError) {
      setError(
        rpcError.message.includes("create_monthly_bills")
          ? "Run 025_create_bills_with_variables.sql in Supabase first."
          : `Couldn't create the bills (${rpcError.message}).`
      );
      return;
    }
    router.push("/landlord/rent-ledger");
    router.refresh();
  }

  const month = monthTitle(preview.month);

  if (bills.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-8">
        <h2 className="text-lg font-bold text-slate-900">No bills to create for {month}</h2>
        <p className="text-sm text-slate-500">
          Every tenant who should be billed this month already has a bill. A tenant who paid
          advance rent is billed from the month after their lease starts.
        </p>
        <div className="mt-2">
          <Link
            href="/landlord/rent-ledger"
            className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Back to rent ledger
          </Link>
        </div>
      </section>
    );
  }

  // One column for the room, then a column per variable charge
  const template = [
    "minmax(150px,1.4fr)",
    "70px",
    "110px",
    "120px",
    "minmax(170px,1.3fr)",
    ...groups.map(() => "minmax(160px,1fr)"),
    "130px",
  ].join(" ");

  return (
    <div className="flex flex-col gap-6">
      {/* Variable charges: one amount for everyone, or one per tenant */}
      {groups.length > 0 && (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-slate-900">Variable charges</h2>
            <p className="text-sm text-slate-500">
              These change every month, so you type them in. Turn on &ldquo;Same for everyone&rdquo; to
              use one amount for every tenant who has the charge, or turn it off to enter each
              tenant&apos;s own amount in the table below. Leave an amount empty to skip it.
            </p>
          </div>

          {groups.map((g) => (
            <div
              key={g.key}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-[15px] font-semibold text-slate-900">
                  {g.name}
                  <span className={variablePill}>Variable</span>
                </p>
                <p className="text-xs text-slate-500">
                  {g.count} tenant{g.count === 1 ? "" : "s"} {g.count === 1 ? "has" : "have"} this charge
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-900">
                  <Toggle
                    checked={isEveryone(g.key)}
                    onChange={(v) => setEveryone((s) => ({ ...s, [g.key]: v }))}
                    label={`Same ${g.name} amount for everyone`}
                  />
                  Same for everyone
                </label>
                {isEveryone(g.key) ? (
                  <div className="w-[170px]">
                    <MoneyInput
                      label={`${g.name} amount for everyone`}
                      value={common[g.key] ?? ""}
                      onChange={(v) => setCommon((s) => ({ ...s, [g.key]: v }))}
                      placeholder="0.00"
                    />
                  </div>
                ) : (
                  <span className="text-xs text-slate-500">Enter each tenant&apos;s amount below</span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* The bills that will be created */}
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-slate-900">Bills to create</h2>
            <p className="text-sm text-slate-500">
              The rent and the fixed charges come from each lease, so they are read-only here.
            </p>
          </div>
          <div className="flex flex-col items-end">
            <p className="text-xs text-slate-500">Total of all bills</p>
            <p className="text-xl font-bold text-slate-900">{formatPeso(grandTotal)}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div
              style={{ gridTemplateColumns: template }}
              className="grid items-center gap-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-500"
            >
              <span>Tenant</span>
              <span>Unit</span>
              <span>Due date</span>
              <span>
                Rent<span className={fixedPill}>Fixed</span>
              </span>
              <span>
                Fixed charges<span className={fixedPill}>Fixed</span>
              </span>
              {groups.map((g) => (
                <span key={g.key}>
                  {g.name}
                  <span className={variablePill}>Variable</span>
                </span>
              ))}
              <span className="text-right">Bill total</span>
            </div>

            {bills.map((b) => (
              <div
                key={b.lease_id}
                style={{ gridTemplateColumns: template }}
                className="grid items-center gap-4 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0"
              >
                <span className="truncate font-semibold text-slate-900">{b.tenant_name}</span>
                <span className="text-slate-900">{shortLabel(b.unit_label)}</span>
                <span className="text-slate-600">{numericDate(b.due_date)}</span>
                <span className="text-slate-600">{formatPeso(Number(b.rent))}</span>
                <span className="flex flex-col text-slate-600">
                  {b.fixed.length === 0 ? (
                    <span>—</span>
                  ) : (
                    b.fixed.map((f) => (
                      <span key={f.charge_id} className="text-xs">
                        {f.name}: {formatPeso(Number(f.amount ?? 0))}
                      </span>
                    ))
                  )}
                </span>
                {groups.map((g) => {
                  const has = b.variable.some((v) => keyOf(v.name) === g.key);
                  if (!has) return <span key={g.key} className="text-slate-400">—</span>;
                  if (isEveryone(g.key)) {
                    const n = amountFor(b.lease_id, g.key);
                    return (
                      <span key={g.key} className="text-slate-600">
                        {n > 0 ? formatPeso(n) : "—"}
                      </span>
                    );
                  }
                  const id = `${b.lease_id}|${g.key}`;
                  return (
                    <div key={g.key}>
                      <MoneyInput
                        label={`${g.name} for ${b.tenant_name}`}
                        value={each[id] ?? ""}
                        onChange={(v) => setEach((s) => ({ ...s, [id]: v }))}
                        placeholder="0.00"
                      />
                    </div>
                  );
                })}
                <span className="text-right font-semibold text-slate-900">{formatPeso(totalFor(b))}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={saving}>
          {saving ? "Creating…" : `Create ${bills.length} bill${bills.length === 1 ? "" : "s"}`}
        </Button>
        <Link
          href="/landlord/rent-ledger"
          className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
        >
          Cancel
        </Link>
        <p className="text-xs text-slate-500">
          Each tenant gets a notification when their bill is created.
        </p>
      </div>
    </div>
  );
}