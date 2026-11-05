import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-[10px] bg-sky-700 text-xl font-bold text-white">
        A
      </span>
      <span className="text-[22px] font-bold text-slate-900">Aptify</span>
    </Link>
  );
}