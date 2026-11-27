"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { manilaToday } from "@/lib/dates";
import { formatPeso } from "@/lib/format";
import type { LeaseCharge, LeaseDetails } from "@/lib/lease";
import { numericDate } from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";
import { dueDayLabel, fmtMoney, parseMoney } from "@/lib/units";
import { inputClass, Labeled, MoneyInput } from "./ui";

type Draft = {
  key: number;
  id?: string;
  name: string;
  category: LeaseCharge["category"];
  mode: LeaseCharge["mode"];
  amount: string;
};

// The current month and the next three, as { value: "2026-11-01", label: "November 2026 (this month)" }
function monthOptions() {
  const [y, m] = manilaToday().split("-").map(Number);
  return [0, 1, 2, 3].map((i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return { value: d.toISOString().slice(0, 10), label: i === 0 ? `${label} (this month)` : label };
  });
}

const selectCls = `${inputClass()} cursor-pointer`;
const sectionTitle = "text-[15px] font-bold text-slate-900";

export function EditLeaseDialog({ leaseId, onClose }: { leaseId: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const nextKey = useRef(1);

  const [details, setDetails] = useState<LeaseDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rent, setRent] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [effective, setEffective] = useState("");
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [advance, setAdvance] = useState("");
  const [charges, setCharges] = useState<Draft[]>([]);

  const months = monthOptions();

  // Close with Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the lease
  useEffect(() => {
    let alive = true;

    async function load() {
      const { data, error: rpcError } = await createClient().rpc("landlord_lease_details", {
        p_lease: leaseId,
      });
      if (!alive) return;
      if (rpcError || !data) {
        setLoadFailed(true);
        setLoading(false);
        return;
      }
      const d = data as LeaseDetails;
      setDetails(d);
      setRent(fmtMoney(Number(d.monthly_rent)));
      setDueDay(String(d.due_day));
      // If this month's bill already exists, a change can only apply from next month
      setEffective(monthOptions()[d.has_current_bill ? 1 : 0].value);
      setEndDate(d.end_date ?? "");
      setStartDate(d.start_date);
      setDeposit(fmtMoney(Number(d.security_deposit)));
      setAdvance(fmtMoney(Number(d.advance_rent)));
      setCharges(
        d.charges.map((c) => ({
          key: nextKey.current++,
          id: c.id,
          name: c.name,
          category: c.category,
          mode: c.mode,
          amount: c.fixed_amount === null ? "" : fmtMoney(Number(c.fixed_amount)),
        }))
      );
      setLoading(false);
    }

    void load();
    return () => {
      alive = false;
    };
  }, [leaseId]);

  function updateCharge(key: number, patch: Partial<Draft>) {
    setCharges((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addCharge() {
    setCharges((list) => [
      ...list,
      { key: nextKey.current++, name: "", category: "fee", mode: "fixed", amount: "" },
    ]);
  }

  async function save() {
    if (!details) return;
    const pending = details.status === "pending";

    const rentNum = parseMoney(rent);
    if (rentNum === null) return setError("Enter the monthly rent, like 8,500.00.");
    const due = Number(dueDay);
    if (!(due >= 1 && due <= 28)) return setError("Pick a due day from 1 to 28.");

    const first = pending ? startDate : details.start_date;
    if (pending && !startDate) return setError("Pick the lease start date.");
    if (endDate && first && endDate < first) return setError("The end date can't be before the start date.");

    let depositNum = 0;
    let advanceNum = 0;
    if (pending) {
      const dp = parseMoney(deposit || "0");
      const ad = parseMoney(advance || "0");
      if (dp === null || ad === null) return setError("Enter the deposit and the advance rent as amounts.");
      depositNum = dp;
      advanceNum = ad;
    }

    const seen = new Set<string>();
    const chargeList: Record<string, unknown>[] = [];
    for (const c of charges) {
      const name = c.name.trim();
      if (!name) return setError("Every charge needs a name. Remove the empty one or fill it in.");
      if (seen.has(name.toLowerCase())) return setError(`"${name}" is listed twice. Charge names must be different.`);
      seen.add(name.toLowerCase());
      let amount: number | null = null;
      if (c.mode === "fixed") {
        amount = parseMoney(c.amount);
        if (amount === null) return setError(`Enter the amount for "${name}", or make it a variable charge.`);
      }
      chargeList.push({ id: c.id, name, category: c.category, mode: c.mode, fixed_amount: amount });
    }

    const changes: Record<string, unknown> = {
      monthly_rent: rentNum,
      due_day: due,
      end_date: endDate || null,
      charges: chargeList,
    };
    if (pending) {
      changes.start_date = startDate;
      changes.security_deposit = depositNum;
      changes.advance_rent = advanceNum;
    } else {
      changes.effective_from = effective;
      if (reason.trim()) changes.change_reason = reason.trim();
    }

    setSaving(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("update_lease", {
      p_lease: leaseId,
      p_changes: changes,
    });
    setSaving(false);

    if (rpcError) {
      const m = rpcError.message;
      setError(
        m.includes("update_lease")
          ? "Run 026_edit_lease.sql in Supabase first."
          : m.includes("invalid_effective_from")
            ? "The change can't start in a month that has already passed."
            : m.includes("end_date") || m.includes("check")
              ? "The end date can't be before the start date."
              : m.includes("duplicate") || m.includes("unique")
                ? "Two charges have the same name."
                : "Couldn't save the lease. Please try again."
      );
      return;
    }
    toast("ok", "Lease updated.");
    router.refresh();
    onClose();
  }

  const pending = details?.status === "pending";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-lease-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[680px] flex-col rounded-2xl bg-white shadow-xl"
      >
        <div className="flex flex-col gap-1 border-b border-slate-200 px-7 py-5">
          <h2 id="edit-lease-title" className="text-xl font-bold text-slate-900">
            Edit lease
          </h2>
          {details && (
            <p className="text-sm text-slate-500">
              {shortLabel(details.unit_label)} ·{" "}
              {details.tenant_name ?? "Waiting for the tenant to join"}
            </p>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-7 py-6">
          {loading && <p className="text-sm text-slate-500">Loading the lease…</p>}
          {loadFailed && (
            <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
              Couldn&apos;t load the lease. Make sure you ran 026_edit_lease.sql in Supabase, then try again.
            </p>
          )}

          {details && (
            <>
              {/* Lease dates and move-in amounts */}
              <section className="flex flex-col gap-3">
                <h3 className={sectionTitle}>Lease</h3>
                {pending ? (
                  <>
                    <p className="text-xs text-slate-500">
                      The tenant hasn&apos;t joined yet, so you can still change these.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Labeled label="Lease start">
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className={inputClass()}
                        />
                      </Labeled>
                      <Labeled label="Security deposit">
                        <MoneyInput label="Security deposit" value={deposit} onChange={setDeposit} placeholder="0.00" />
                      </Labeled>
                      <Labeled label="Advance rent">
                        <MoneyInput label="Advance rent" value={advance} onChange={setAdvance} placeholder="0.00" />
                      </Labeled>
                    </div>
                  </>
                ) : (
                  <p className="rounded-[10px] bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Started {numericDate(details.start_date)}. The security deposit (
                    {formatPeso(Number(details.security_deposit))}) and advance rent (
                    {formatPeso(Number(details.advance_rent))}) were already billed, so they can&apos;t be
                    changed here.
                  </p>
                )}
                <div className="sm:max-w-[240px]">
                  <Labeled
                    label="Lease end date (optional)"
                    hint="No bills are created after this date."
                  >
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className={inputClass()}
                    />
                  </Labeled>
                </div>
              </section>

              {/* Rent and due day */}
              <section className="flex flex-col gap-3">
                <h3 className={sectionTitle}>Rent and due date</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labeled label="Monthly rent">
                    <MoneyInput label="Monthly rent" value={rent} onChange={setRent} placeholder="0.00" />
                  </Labeled>
                  <Labeled label="Due on">
                    <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={selectCls}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {dueDayLabel(d)}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                </div>
                {!pending && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Labeled
                        label="Changes apply from"
                        hint={
                          details.has_current_bill
                            ? "This month's bill is already created, so it keeps its amounts."
                            : "Bills already created keep their amounts."
                        }
                      >
                        <select
                          value={effective}
                          onChange={(e) => setEffective(e.target.value)}
                          className={selectCls}
                        >
                          {months.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </Labeled>
                      <Labeled label="Reason (optional)" hint="Kept in the lease history.">
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="e.g. Yearly rent adjustment"
                          className={inputClass()}
                        />
                      </Labeled>
                    </div>
                    <p className="text-xs text-slate-500">
                      Only changes to the rent or the due date are saved as a new set of terms. If you don&apos;t
                      change them, nothing is recorded.
                    </p>
                  </>
                )}
              </section>

              {/* Charges */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className={sectionTitle}>Charges</h3>
                  <p className="text-xs text-slate-500">
                    A fixed charge is added to every bill at the same amount. For a variable charge you type
                    the amount each month when you create the bills. Changes apply to bills created from now on.
                  </p>
                </div>

                {charges.length === 0 && (
                  <p className="rounded-[10px] bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No charges. Bills will only have the monthly rent.
                  </p>
                )}

                {charges.map((c) => (
                  <div key={c.key} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <Labeled label="Name">
                          <input
                            value={c.name}
                            onChange={(e) => updateCharge(c.key, { name: e.target.value })}
                            placeholder="e.g. Water"
                            className={inputClass()}
                          />
                        </Labeled>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCharges((list) => list.filter((x) => x.key !== c.key))}
                        className="mb-1 cursor-pointer rounded-[10px] px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Labeled label="Charged as">
                        <select
                          value={c.mode}
                          onChange={(e) =>
                            updateCharge(c.key, { mode: e.target.value as Draft["mode"] })
                          }
                          className={selectCls}
                        >
                          <option value="fixed">Fixed amount</option>
                          <option value="variable">Variable (typed each month)</option>
                        </select>
                      </Labeled>
                      <Labeled label="Type">
                        <select
                          value={c.category}
                          onChange={(e) =>
                            updateCharge(c.key, { category: e.target.value as Draft["category"] })
                          }
                          className={selectCls}
                        >
                          <option value="utility">Utility</option>
                          <option value="fee">Fee</option>
                          <option value="other">Other</option>
                        </select>
                      </Labeled>
                      <Labeled label="Amount">
                        {c.mode === "fixed" ? (
                          <MoneyInput
                            label={`${c.name || "Charge"} amount`}
                            value={c.amount}
                            onChange={(v) => updateCharge(c.key, { amount: v })}
                            placeholder="0.00"
                          />
                        ) : (
                          <p className="rounded-[10px] bg-slate-50 px-3.5 py-3 text-sm text-slate-500">
                            Entered each month
                          </p>
                        )}
                      </Labeled>
                    </div>
                  </div>
                ))}

                <div>
                  <Button type="button" variant="outline" size="sm" onClick={addCharge}>
                    + Add charge
                  </Button>
                </div>
              </section>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-200 px-7 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving || loading || !details}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}