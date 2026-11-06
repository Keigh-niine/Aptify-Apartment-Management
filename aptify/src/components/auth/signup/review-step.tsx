"use client";

import { Button } from "@/components/ui/button";
import { propertyTypes, shortLabel, type PropertyData, type UnitItem } from "@/lib/signup";
import { Card, WizardHeader } from "./wizard-parts";

export function ReviewStep({
  property,
  units,
  error,
  loading,
  onCreate,
  onBack,
}: {
  property: PropertyData;
  units: UnitItem[];
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onBack: () => void;
}) {
  const typeLabel = propertyTypes.find((t) => t.value === property.type)?.label;
  const rows = [
    ["Name", property.name],
    ["Address", `${property.street}, ${property.city}`],
    ["Type", typeLabel ?? ""],
    ["Units", String(units.length)],
  ];

  const next = [
    { done: true, title: "Your property is created", text: "You become its owner." },
    { done: true, title: "Units are added", text: `${units.length} unit${units.length === 1 ? "" : "s"} added.` },
    { done: false, title: "Invite your tenants", text: "Generate a code for each unit." },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <WizardHeader
        title="Review and create"
        subtitle="Check the details before creating your property."
        current={3}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Card className="flex flex-1 flex-col gap-4">
          <h3 className="text-lg font-bold text-slate-900">Property summary</h3>

          <div className="flex flex-col">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-[7px] text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="text-right font-semibold text-slate-900">{value}</span>
              </div>
            ))}
          </div>

          <div className="h-px bg-slate-200" />

          <p className="text-[13px] font-semibold text-slate-900">Units</p>
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <span
                key={u.id}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-900"
              >
                {shortLabel(u.label)}
              </span>
            ))}
          </div>

          {error && (
            <div role="alert" className="rounded-[10px] bg-red-100 p-3 text-sm font-medium text-red-800">
              {error}
            </div>
          )}

          <div className="flex gap-2.5">
            <Button type="button" onClick={onCreate} disabled={loading}>
              {loading ? "Creating…" : "Create property"}
            </Button>
            <Button type="button" variant="outline" onClick={onBack} disabled={loading}>
              Back
            </Button>
          </div>
        </Card>

        <Card className="w-full lg:w-[340px] lg:shrink-0">
          <h3 className="mb-2 text-lg font-bold text-slate-900">What happens next</h3>
          {next.map((n) => (
            <div key={n.title} className="flex items-start gap-3 py-1.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-bold text-sky-700">
                {n.done ? "✓" : "•"}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                <p className="text-xs text-slate-500">{n.text}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
