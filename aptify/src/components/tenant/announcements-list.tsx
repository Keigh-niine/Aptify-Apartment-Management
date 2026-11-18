"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";
import { ago } from "@/lib/time";

export type TenantAnnouncement = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  unread: boolean;
};

type Tab = "all" | "unread";

export function AnnouncementsList({
  userId,
  items,
}: {
  userId: string;
  items: TenantAnnouncement[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState(false);

  const unreadCount = items.filter((a) => a.unread).length;
  const shown = items.filter((a) => tab === "all" || a.unread);

  // Reading is recorded by marking the announcement's notification as read.
  async function markRead(announcementId?: string) {
    setBusy(true);
    let query = createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .eq("type", "announcement")
      .is("read_at", null);
    if (announcementId) query = query.eq("announcement_id", announcementId);

    const { error } = await query;
    setBusy(false);

    if (error) {
      toast("err", "Something went wrong. Please try again.");
      return;
    }
    router.refresh();
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: "all", label: "All" },
    { value: "unread", label: `Unread (${unreadCount})` },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tab === t.value}
              onClick={() => setTab(t.value)}
              className={`cursor-pointer rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold ${
                tab === t.value
                  ? "border-sky-700 bg-sky-700 text-white"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => markRead()}
            className="cursor-pointer text-[13px] font-semibold text-sky-700 hover:underline disabled:opacity-60"
          >
            Mark all as read
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-lg font-bold text-slate-900">No announcements yet</p>
          <p className="text-sm text-slate-500">
            When your landlord posts a notice, it will show up here.
          </p>
        </div>
      )}

      {items.length > 0 && shown.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          You&apos;re all caught up. There&apos;s nothing unread.
        </p>
      )}

      {shown.map((a) => (
        <article
          key={a.id}
          className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="truncate text-base font-bold text-slate-900">{a.title}</h2>
              {a.unread && (
                <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                  New
                </span>
              )}
            </div>
            {a.unread && (
              <button
                type="button"
                disabled={busy}
                onClick={() => markRead(a.id)}
                className="shrink-0 cursor-pointer text-xs font-semibold text-sky-700 hover:underline disabled:opacity-60"
              >
                Mark as read
              </button>
            )}
          </div>
          <p className="whitespace-pre-line text-sm leading-[22px] text-slate-700">{a.body}</p>
          <p className="text-xs text-slate-500">Landlord · {ago(a.published_at)}</p>
        </article>
      ))}
    </div>
  );
}
