import { notFound } from "next/navigation";

export const instant = false;

const sections: Record<string, string> = {
  "rent-ledger": "Rent ledger",
  maintenance: "Maintenance",
  announcements: "Announcements",
  units: "Units and invites",
};

// Placeholder pages. Each one is replaced when we build the real screen.
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const title = sections[section];
  if (!title) notFound();

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[30px] font-bold text-slate-900">{title}</h1>
      <p className="text-[15px] text-slate-500">This page is coming soon.</p>
    </div>
  );
}
