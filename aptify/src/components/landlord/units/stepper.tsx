import { Fragment } from "react";

// current = 1..3 is the active step. Use 4 when every step is finished.
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {steps.map((label, i) => {
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
                className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
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
  );
}
