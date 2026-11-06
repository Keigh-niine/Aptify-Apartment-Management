import Link from "next/link";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span
        className={`flex size-9 items-center justify-center rounded-[10px] text-xl font-bold ${
          inverted ? "bg-white text-sky-700" : "bg-sky-700 text-white"
        }`}
      >
        A
      </span>
      <span className={`text-[22px] font-bold ${inverted ? "text-white" : "text-slate-900"}`}>
        Aptify
      </span>
    </Link>
  );
}
