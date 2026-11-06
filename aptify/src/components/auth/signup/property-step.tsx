"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { propertyTypes, type PropertyData, type PropertyType } from "@/lib/signup";
import { Field } from "../field";
import { Card, WizardHeader } from "./wizard-parts";

type Errors = Partial<Record<"name" | "street" | "city" | "province" | "unitCount", string>>;

const tips = [
  { title: "You will be the landlord", text: "You manage rent, repairs, and announcements yourself." },
  { title: "Tenants join with a code", text: "Each unit gets its own single-use invite code." },
  { title: "You can edit this later", text: "Names and units can be changed anytime." },
];

export function PropertyStep({
  initial,
  onNext,
  onCancel,
}: {
  initial: PropertyData;
  onNext: (data: PropertyData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...initial, unitCount: String(initial.unitCount) });
  const [errors, setErrors] = useState<Errors>({});

  const set =
    (key: "name" | "street" | "city" | "province" | "unitCount") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!form.name.trim()) next.name = "Enter the property name.";
    if (!form.street.trim()) next.street = "Enter the street address.";
    if (!form.city.trim()) next.city = "Enter the city.";
    if (!form.province.trim()) next.province = "Enter the province or region.";
    const count = Number(form.unitCount);
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      next.unitCount = "Enter a number from 1 to 200.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onNext({
      name: form.name.trim(),
      street: form.street.trim(),
      city: form.city.trim(),
      province: form.province.trim(),
      type: form.type,
      unitCount: count,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <WizardHeader
        title="Create a property"
        subtitle="Set up your property, then add its units."
        current={1}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Card className="flex-1">
          <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
            <h3 className="text-lg font-bold text-slate-900">Property details</h3>

            <Field label="Property name" value={form.name} onChange={set("name")} error={errors.name} />
            <Field
              label="Street address"
              value={form.street}
              onChange={set("street")}
              error={errors.street}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="City" value={form.city} onChange={set("city")} error={errors.city} />
              <Field
                label="Province / Region"
                value={form.province}
                onChange={set("province")}
                error={errors.province}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium text-slate-900">Property type</p>
              <div className="flex flex-wrap gap-2">
                {propertyTypes.map((t) => {
                  const active = form.type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setForm((f) => ({ ...f, type: t.value as PropertyType }))}
                      className={`rounded-[10px] border px-4 py-[9px] text-sm ${
                        active
                          ? "border-sky-700 bg-sky-100 font-semibold text-sky-700"
                          : "border-slate-300 bg-white font-medium text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field
              label="Number of units"
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              value={form.unitCount}
              onChange={set("unitCount")}
              error={errors.unitCount}
            />

            <div className="flex gap-2.5">
              <Button type="submit">Next: Add units</Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>

        <Card className="w-full lg:w-[340px] lg:shrink-0">
          <h3 className="mb-2 text-lg font-bold text-slate-900">Good to know</h3>
          {tips.map((t) => (
            <div key={t.title} className="flex items-start gap-3 py-1.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-bold text-sky-700">
                •
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                <p className="text-xs text-slate-500">{t.text}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
