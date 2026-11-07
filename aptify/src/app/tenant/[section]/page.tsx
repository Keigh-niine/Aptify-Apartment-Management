import { notFound } from "next/navigation";

export const instant = false;

const sections: Record<string, string> = {
  payments: "Payments",
  maintenance: "Maintenance",
  announcements: "Announcements",
};

export default async function TenantSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const title = sections[section];
  if (!title) notFound();

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[30px] font-bold text-slate-900">{title}</h1>
      <p className="text-[15px] text-slate-500">Page coming soon.</p>
    </div>
  );
}