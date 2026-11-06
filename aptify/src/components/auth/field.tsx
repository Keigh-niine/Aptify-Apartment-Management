import { forwardRef, type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  invalid?: boolean;
};

export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, hint, invalid, id, className = "", ...props },
  ref
) {
  const inputId = id ?? props.name;
  const hasError = invalid ?? !!error;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-slate-900">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={hasError}
        className={`w-full rounded-[10px] border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 ${
          hasError
            ? "border-red-600 focus:ring-red-100"
            : "border-slate-300 focus:border-sky-700 focus:ring-sky-100"
        } ${className}`}
        {...props}
      />
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});
