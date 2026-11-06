import { Fragment } from "react";

export function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-[13px] font-medium text-sky-700">Step {step} of 2</p>
      <div className="flex gap-1.5">
        <div className="h-1 flex-1 rounded-sm bg-sky-700" />
        <div className={`h-1 flex-1 rounded-sm ${step === 2 ? "bg-sky-700" : "bg-slate-200"}`} />
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 ${className}`}>
      {children}
    </div>
  );
}

const stepLabels = ["Property details", "Add units", "Review"];

export function WizardHeader({
  title,
  subtitle,
  current,
}: {
  title: string;
  subtitle: string;
  current: 1 | 2 | 3;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[30px] font-bold text-slate-900">{title}</h2>
        <p className="text-[15px] text-slate-500">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <Fragment key={label}>
              {i > 0 && (
                <span
                  className={`hidden h-0.5 w-14 sm:block ${n <= current ? "bg-sky-700" : "bg-slate-300"}`}
                />
              )}
              <div className="flex items-center gap-3">
                <span
                  className={`flex size-[26px] items-center justify-center rounded-full text-xs font-bold ${
                    done || active
                      ? "bg-sky-700 text-white"
                      : "border border-slate-300 bg-white text-slate-500"
                  }`}
                >
                  {done ? "✓" : n}
                </span>
                <span
                  className={`text-sm ${
                    active
                      ? "font-semibold text-slate-900"
                      : done
                        ? "font-medium text-slate-900"
                        : "font-medium text-slate-500"
                  }`}
                >
                  {label}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
