"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";
import { fullDate, mailDate } from "@/lib/mail-date";
import { MAIL_NOTIFICATION_TYPES, type MailItem } from "@/lib/tenant-notifications";

const PAGE_SIZE = 50;
type Filter = "all" | "unread";

export function MailInbox({ userId, items }: { userId: string; items: MailItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unreadCount = items.filter((m) => m.unread).length;
  const filtered = items.filter((m) => filter === "all" || m.unread);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : current * PAGE_SIZE + 1;
  const to = current * PAGE_SIZE + shown.length;
  const opened = items.find((m) => m.key === openKey) ?? null;

  // Reading a message marks its notification as read
  async function markRead(m: MailItem) {
    const base = createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .is("read_at", null);
    await (m.kind === "announcement" ? base.eq("announcement_id", m.id) : base.eq("id", m.id));
    router.refresh(); // updates the unread badge in the sidebar
  }

  function open(m: MailItem) {
    setOpenKey(m.key);
    if (m.unread) void markRead(m);
  }

  async function markAllRead() {
    setBusy(true);
    const { error } = await createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .in("type", [...MAIL_NOTIFICATION_TYPES, "announcement"])
      .is("read_at", null);
    setBusy(false);
    if (error) {
      toast("err", "Something went wrong. Please try again.");
      return;
    }
    router.refresh();
  }

  // ---- An opened message
  if (opened) {
    return (
      <article className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6">
        <button
          type="button"
          onClick={() => setOpenKey(null)}
          aria-label="Back to Mail"
          title="Back to Mail"
          className="flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>

        <h2 className="text-[22px] font-semibold text-slate-900">{opened.subject}</h2>

        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
            {opened.sender[0]}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-slate-900">{opened.sender}</span>
            <span className="text-xs text-slate-500">{fullDate(opened.date)}</span>
          </div>
        </div>

        {opened.body && (
          <p className="whitespace-pre-line text-sm leading-[22px] text-slate-700">{opened.body}</p>
        )}

        {opened.action && (
          <Link
            href={opened.action.href}
            className="inline-flex w-fit items-center justify-center rounded-[10px] bg-sky-700 px-5 py-[11px] text-sm font-semibold text-white hover:bg-sky-800"
          >
            {opened.action.label}
          </Link>
        )}
      </article>
    );
  }

  // ---- The inbox
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={() => router.refresh()}
          aria-label="Refresh"
          title="Refresh"
          className="flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          <RefreshCw className="size-[18px]" aria-hidden />
        </button>

        <div role="tablist" aria-label="Mail filter" className="flex gap-1">
          {(
            [
              { value: "all", label: "All" },
              { value: "unread", label: `Unread (${unreadCount})` },
            ] as { value: Filter; label: string }[]
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={filter === t.value}
              onClick={() => {
                setFilter(t.value);
                setPage(0);
              }}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                filter === t.value ? "bg-sky-100 text-sky-800" : "text-slate-600 hover:bg-slate-100"
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
            className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-60"
          >
            Mark all as read
          </button>
        )}

        <div className="ml-auto flex items-center gap-1 text-xs text-slate-600">
          <span className="mr-1">
            {from}–{to} of {filtered.length}
          </span>
          <button
            type="button"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="Newer"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
            aria-label="Older"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-slate-100 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Rows */}
      {shown.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-500">
          {items.length === 0
            ? "No mail yet. Announcements and reminders from your landlord will show up here."
            : "You're all caught up. There's nothing unread."}
        </p>
      ) : (
        <ul>
          {shown.map((m) => (
            <li key={m.key} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                onClick={() => open(m)}
                className={`flex w-full cursor-pointer flex-col gap-0.5 px-4 py-3 text-left text-sm hover:shadow-[inset_1px_0_0_#cbd5e1,inset_-1px_0_0_#cbd5e1,0_1px_2px_rgba(15,23,42,0.15)] sm:flex-row sm:items-center sm:gap-4 ${
                  m.unread ? "bg-white" : "bg-slate-50"
                }`}
              >
                <span
                  className={`truncate sm:w-[180px] sm:shrink-0 ${
                    m.unread ? "font-bold text-slate-900" : "text-slate-700"
                  }`}
                >
                  {m.sender}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className={m.unread ? "font-bold text-slate-900" : "text-slate-700"}>
                    {m.subject}
                  </span>
                  {m.body && (
                    <span className="text-slate-500"> – {m.body.replace(/\s+/g, " ")}</span>
                  )}
                </span>
                <span
                  suppressHydrationWarning
                  className={`shrink-0 text-xs sm:w-[72px] sm:text-right ${
                    m.unread ? "font-bold text-slate-900" : "text-slate-500"
                  }`}
                >
                  {mailDate(m.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}