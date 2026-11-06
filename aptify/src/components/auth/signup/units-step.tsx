"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { generateUnits, nextUnitId, shortLabel, type UnitItem } from "@/lib/signup";
import { Field } from "../field";
import { Card, WizardHeader } from "./wizard-parts";

const PREVIEW_ROWS = 5;

export function UnitsStep({
  units,
  onChange,
  onNext,
  onBack,
}: {
  units: UnitItem[];
  onChange: (units: UnitItem[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const startPerFloor = Math.min(4, units.length || 4);
  const [floors, setFloors] = useState(String(Math.max(1, Math.ceil(units.length / startPerFloor))));
  const [perFloor, setPerFloor] = useState(String(startPerFloor));
  const [expanded, setExpanded] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [quickError, setQuickError] = useState("");

  // Duplicate / empty label detection
  const counts = new Map<string, number>();
  units.forEach((u) => {
    const k = u.label.trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const rowInvalid = (u: UnitItem) => {
    const k = u.label.trim().toLowerCase();
    return k === "" || (counts.get(k) ?? 0) > 1;
  };
  const hasInvalid = units.some(rowInvalid);

  const visible = expanded ? units : units.slice(0, PREVIEW_ROWS);
  const hidden = units.length - PREVIEW_ROWS;

  // Naming preview for quick add, e.g. "1A, 1B, 1C … 3D"
  const f = Number(floors);
  const p = Number(perFloor);
  const validQuick = Number.isInteger(f) && Number.isInteger(p) && f >= 1 && f <= 99 && p >= 1 && p <= 26;
  let naming = "";
  if (validQuick) {
    const sample = generateUnits(f, p).map((u) => shortLabel(u.label));
    naming = sample.length <= 4 ? sample.join(", ") : `${sample.slice(0, 3).join(", ")} … ${sample[sample.length - 1]}`;
  }

  function generate() {
    if (!validQuick) {
      setQuickError("Floors: 1 to 99. Units per floor: 1 to 26.");
      return;
    }
    setQuickError("");
    setShowErrors(false);
    setExpanded(false);
    onChange(generateUnits(f, p));
  }

  function next() {
    if (units.length === 0 || hasInvalid) {
      setShowErrors(true);
      setExpanded(true);
      return;
    }
    onNext();
  }

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <WizardHeader title="Add units" subtitle="Add each unit to your property." current={2} />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Card className="flex flex-1 flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Units ({units.length})</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onChange([...units, { id: nextUnitId(), label: "" }]);
                setExpanded(true);
              }}
            >
              + Add unit
            </Button>
          </div>

          {units.length > 0 && <p className="px-1 text-xs font-semibold text-slate-500">Unit label</p>}

          {visible.map((u) => (
            <div key={u.id} className="flex items-center gap-3">
              <input
                value={u.label}
                placeholder="Unit 1A"
                aria-label="Unit label"
                aria-invalid={showErrors && rowInvalid(u)}
                onChange={(e) =>
                  onChange(units.map((x) => (x.id === u.id ? { ...x, label: e.target.value } : x)))
                }
                className={`min-w-0 flex-1 rounded-lg border bg-white px-3 py-[9px] text-sm font-medium text-slate-900 outline-none focus:ring-2 ${
                  showErrors && rowInvalid(u)
                    ? "border-red-600 focus:ring-red-100"
                    : "border-slate-300 focus:border-sky-700 focus:ring-sky-100"
                }`}
              />
              <button
                type="button"
                aria-label={`Remove ${u.label || "unit"}`}
                onClick={() => onChange(units.filter((x) => x.id !== u.id))}
                className="px-1 text-sm text-slate-500 hover:text-slate-900"
              >
                ✕
              </button>
            </div>
          ))}

          {!expanded && hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="self-start text-left text-[13px] font-medium text-slate-500 hover:text-slate-900"
            >
              + {hidden} more unit{hidden === 1 ? "" : "s"} (
              {shortLabel(units[PREVIEW_ROWS].label)} to {shortLabel(units[units.length - 1].label)})
            </button>
          )}
          {expanded && units.length > PREVIEW_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="self-start text-[13px] font-medium text-slate-500 hover:text-slate-900"
            >
              Show fewer
            </button>
          )}

          {showErrors && units.length === 0 && (
            <p className="text-xs text-red-600">Add at least one unit.</p>
          )}
          {showErrors && hasInvalid && (
            <p className="text-xs text-red-600">Every unit needs a label, and labels must be different.</p>
          )}

          <div className="mt-1 flex gap-2.5">
            <Button type="button" onClick={next}>
              Next: Review
            </Button>
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
          </div>
        </Card>

        <div className="flex w-full flex-col gap-5 lg:w-[340px] lg:shrink-0">
          <Card className="flex flex-col gap-3">
            <h3 className="text-lg font-bold text-slate-900">Quick add</h3>
            <p className="text-[13px] text-slate-500">Generate many units at once.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Floors"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={floors}
                onChange={(e) => setFloors(e.target.value)}
              />
              <Field
                label="Units per floor"
                type="number"
                inputMode="numeric"
                min={1}
                max={26}
                value={perFloor}
                onChange={(e) => setPerFloor(e.target.value)}
              />
            </div>
            <Field label="Naming" value={naming} readOnly tabIndex={-1} error={quickError || undefined} />
            <Button type="button" variant="outline" onClick={generate}>
              Generate units
            </Button>
            <p className="text-xs text-slate-500">This replaces the units in the list.</p>
          </Card>

          <Card className="flex flex-col gap-0.5">
            <h3 className="text-lg font-bold text-slate-900">Summary</h3>
            <div className="flex justify-between py-[7px] text-sm">
              <span className="text-slate-500">Total units</span>
              <span className="font-semibold text-slate-900">{units.length}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
