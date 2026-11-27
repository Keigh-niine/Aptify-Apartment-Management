"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";
import { ago } from "@/lib/time";
import {
  notificationHref,
  notificationLabel,
  TENANT_NOTIFICATION_TYPES,
  type TenantNotification,
} from "@/lib/tenant-notifications";

type Tab = "all" | "unread";

export function NotificationsList({
  userId,
  items,
}: {
  userId: string;
  items: TenantNotification[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState(false);

  const unreadCount = items.filter((n) => !n.read_at).length;
  const shown = items.filter((n) => tab === "all" || !n.read_at);

  // Opening a notification marks it read. The page change does not wait for this.
  async function markRead(id: string) {
    await createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("recipient_id", userId)
      .is("read_at", null);
    router.refresh(); // updates the badge in the sidebar
  }

  async function markAllRead() {
    setBusy(true);
    const { error } = await createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .in("type", [...TENANT_NOTIFICATION_TYPES])
      .is("read_at", null);
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
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Notification filter" className="flex gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                tab === t.value
                  ? "bg-sky-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={busy}
            className="cursor-pointer text-sm font-semibold text-sky-700 hover:underline disabled:opacity-60"
          >
            Mark all as read
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          {tab === "unread" ? "You're all caught up." : "No notifications yet."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {shown.map((n) => {
            const unread = !n.read_at;
            return (
              <li key={n.id}>
                <Link
                  href={notificationHref(n)}
                  onClick={() => {
                    if (unread) void markRead(n.id);
                  }}
                  className="flex items-start gap-3 rounded-xl px-2 py-3.5 hover:bg-slate-50"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                      unread ? "bg-sky-600" : "bg-transparent"
                    }`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm text-slate-900 ${unread ? "font-bold" : "font-semibold"}`}
                      >
                        {n.title}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {notificationLabel[n.type]}
                      </span>
                      {unread && <span className="sr-only">Unread</span>}
                    </span>
                    {n.body && <span className="text-sm text-slate-600">{n.body}</span>}
                    <span className="text-xs capitalize text-slate-400">{ago(n.created_at)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}