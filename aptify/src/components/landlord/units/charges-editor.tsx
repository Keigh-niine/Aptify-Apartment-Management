"use client";

import { Button } from "@/components/ui/button";
import { chargeProblems, newCharge, type ChargeDraft } from "@/lib/units";
import { inputClass, MoneyInput } from "./ui";

export function ChargesEditor({
  charges,
  onChange,
  showErrors,
}: {
  charges: ChargeDraft[];
  onChange: (charges: ChargeDraft[]) => void;
  showErrors: boolean;
}) {
  const bad = chargeProblems(charges);
  const update = (id: number, patch: Partial<ChargeDraft>) =>
    onChange(charges.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">Recurring charges</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...charges, newCharge()])}
        >
          + Add charge
        </Button>
      </div>

      {charges.length > 0 && (
        <div className="grid grid-cols-[1fr_88px_150px_24px] gap-3 px-0.5 text-xs font-semibold text-slate-500">
          <span>Charge</span>
          <span>Type</span>
          <span>Amount</span>
          <span />
        </div>
      )}

      {charges.map((c) => {
        const invalid = showErrors && bad.has(c.id);
        return (
          <div key={c.id} className="grid grid-cols-[1fr_88px_150px_24px] items-center gap-3">
            <input
              aria-label="Charge name"
              placeholder="e.g. Internet"
              value={c.name}
              onChange={(e) => update(c.id, { name: e.target.value })}
              className={inputClass(invalid)}
            />
            <button
              type="button"
              title="Click to switch between fixed and variable"
              onClick={() =>
                update(c.id, { mode: c.mode === "fixed" ? "variable" : "fixed", amount: "" })
              }
              className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold ${
                c.mode === "fixed" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-800"
              }`}
            >
              {c.mode === "fixed" ? "Fixed" : "Variable"}
            </button>
            <MoneyInput
              label={`${c.name || "Charge"} amount`}
              value={c.amount}
              disabled={c.mode === "variable"}
              placeholder={c.mode === "variable" ? "Enter monthly" : "0.00"}
              invalid={invalid && c.mode === "fixed"}
              onChange={(v) => update(c.id, { amount: v })}
            />
            <button
              type="button"
              aria-label={`Remove ${c.name || "charge"}`}
              onClick={() => onChange(charges.filter((x) => x.id !== c.id))}
              className="cursor-pointer text-sm text-slate-500 hover:text-slate-900"
            >
              ✕
            </button>
          </div>
        );
      })}

      {showErrors && bad.size > 0 && (
        <p className="text-xs text-red-600">
          Every charge needs a different name, and fixed charges need an amount.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Fixed charges are the same every month. Variable charges are entered each month.
      </p>
    </div>
  );
}
