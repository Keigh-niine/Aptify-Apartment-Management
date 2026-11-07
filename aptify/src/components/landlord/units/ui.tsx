"use client";

import { fmtMoney, parseMoney } from "@/lib/units";

export const inputClass = (invalid?: boolean) =>
  `w-full rounded-[10px] border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 ${
    invalid
      ? "border-red-600 focus:ring-red-100"
      : "border-slate-300 focus:border-sky-700 focus:ring-sky-100"
  }`;

export function Labeled({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="text-[13px] font-medium text-slate-900">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function MoneyInput({
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  label: string;
}) {
  return (
    <div className="relative w-full">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">
        ₱
      </span>
      <input
        inputMode="decimal"
        aria-label={label}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = parseMoney(value);
          if (n !== null) onChange(fmtMoney(n));
        }}
        className={`${inputClass(invalid)} pl-8`}
      />
    </div>
  );
}

export function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-6 ${className}`}
    >
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-10 shrink-0 cursor-pointer rounded-[11px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-sky-300 motion-reduce:transition-none ${
        checked ? "bg-sky-700" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 size-[18px] rounded-full bg-white transition-transform duration-200 motion-reduce:transition-none ${
          checked ? "translate-x-[18px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}
