import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";

export const instant = false;

function PlaceholderPanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex min-h-40 flex-col rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      <p className="mt-4 text-sm text-slate-500">{message}</p>
    </section>
  );
}

export default function TenantHomePage() {
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Home</h1>
        <p className="text-[15px] text-slate-500">Your rental at a glance · {month}</p>
      </div>

      <section className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-500">Rent due</h2>
        <p className="text-[32px] font-bold text-slate-900">—</p>
        <p className="text-sm text-slate-500">Your current balance and due date will appear here.</p>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <PlaceholderPanel title="Payment history" message="Your rent payment history will appear here." />
        <PlaceholderPanel
          title="Maintenance requests"
          message="Requests you have submitted and their status will appear here."
          action={
            <Link
              href="/tenant/maintenance"
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-sky-700 px-3.5 py-[7px] text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              <Wrench className="size-4" aria-hidden />
              Request maintenance
            </Link>
          }
        />
        <PlaceholderPanel
          title="Announcements"
          message="Announcements from your landlord will appear here."
          action={
            <Link
              href="/tenant/announcements"
              aria-label="View announcements"
              title="View announcements"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowRight className="size-5" aria-hidden />
            </Link>
          }
        />
      </div>
    </div>
  );
}