import type { ComponentProps } from "react";

const variants = {
  primary: "bg-sky-700 text-white hover:bg-sky-800",
  outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
} as const;

const sizes = {
  md: "px-5 py-[11px]",
  sm: "px-3.5 py-[7px]",
} as const;

type Props = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-[10px] text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
