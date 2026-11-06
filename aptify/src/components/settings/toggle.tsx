export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
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
