export function SettingsCard({
  title,
  children,
  gap = "gap-[14px]",
}: {
  title: string;
  children: React.ReactNode;
  gap?: string;
}) {
  return (
    <section className={`flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-6 ${gap}`}>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
