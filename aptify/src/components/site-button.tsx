import Link from "next/link";
import type { ComponentProps } from "react";

const variants = {
  primary: "bg-sky-700 text-white hover:bg-sky-800",
  outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
} as const;

const sizes = {
  md: "px-3.5 py-2.5 text-sm sm:px-5 sm:py-[11px]",
  lg: "px-7 py-4 text-base",
} as const;

type Props = ComponentProps<typeof Link> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function SiteButton({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: Props) {
  return (
    <Link
      className={`inline-flex items-center justify-center rounded-[10px] font-semibold transition-colors ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}