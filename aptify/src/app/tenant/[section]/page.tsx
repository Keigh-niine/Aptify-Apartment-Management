import { CalendarDays, Megaphone } from "lucide-react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ago } from "@/lib/time";

export const instant = false;

const sections: Record<string, string> = {
  payments: "Payments",
  maintenance: "Maintenance",
  announcements: "Announcements",
};

// Placeholder pages. Each one is replaced when we build the real screen.
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const title = sections[section];
  if (!title) notFound();

  if (section === "announcements") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });
    const announcements = (data ?? []) as TenantAnnouncement[];

    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">{title}</h1>
          <p className="text-[15px] text-slate-500">
            Updates and notices from your landlord
          </p>
        </div>

        {error ? (
          <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
            Couldn&apos;t load announcements. ({error.message})
          </p>
        ) : announcements.length === 0 ? (
          <section className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
            <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <Megaphone className="size-6" aria-hidden />
            </span>
            <h2 className="text-lg font-bold text-slate-900">You&apos;re all caught up</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Any new notices from your landlord will show up here.
            </p>
          </section>
        ) : (
          <div className="flex flex-col gap-4">
            {announcements.map((announcement) => (
              <article
                key={announcement.id}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                    <Megaphone className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-slate-900">{announcement.title}</h2>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <CalendarDays className="size-3.5" aria-hidden />
                      <time dateTime={announcement.published_at}>
                        {ago(announcement.published_at)}
                      </time>
                    </p>
                    <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {announcement.body}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[30px] font-bold text-slate-900">{title}</h1>
      <p className="text-[15px] text-slate-500">This page is coming soon.</p>
    </div>
  );
}
