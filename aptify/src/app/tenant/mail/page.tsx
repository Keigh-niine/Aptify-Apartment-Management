import { MailInbox } from "@/components/tenant/mail-inbox";
import { getTenantContext } from "@/lib/tenant";
import {
  MAIL_NOTIFICATION_TYPES,
  notificationAction,
  notificationSender,
  type MailItem,
  type TenantNotification,
} from "@/lib/tenant-notifications";

export const instant = false;

type Announcement = { id: string; title: string; body: string; published_at: string; unread: boolean };

export default async function TenantMailPage() {
  const { supabase, user } = await getTenantContext();

  const [announcements, notifications] = await Promise.all([
    supabase.rpc("tenant_announcements"),
    supabase
      .from("notifications")
      .select("id, type, title, body, payment_id, bill_id, maintenance_request_id, read_at, created_at")
      .eq("recipient_id", user.id)
      .in("type", [...MAIL_NOTIFICATION_TYPES])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const failed = announcements.error || notifications.error;
  if (announcements.error) console.error("tenant_announcements failed:", announcements.error.message);
  if (notifications.error) console.error("notifications failed:", notifications.error.message);

  const items: MailItem[] = [
    ...((announcements.data ?? []) as Announcement[]).map((a) => ({
      key: `a-${a.id}`,
      kind: "announcement" as const,
      id: a.id,
      sender: "Landlord",
      subject: a.title,
      body: a.body,
      date: a.published_at,
      unread: a.unread,
    })),
    ...((notifications.data ?? []) as TenantNotification[]).map((n) => ({
      key: `n-${n.id}`,
      kind: "notification" as const,
      id: n.id,
      sender: notificationSender[n.type],
      subject: n.title,
      body: n.body ?? "",
      date: n.created_at,
      unread: !n.read_at,
      action: notificationAction(n),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Mail</h1>
        <p className="text-[15px] text-slate-500">Announcements, reminders and updates from your landlord</p>
      </div>

      {failed && (
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          Some messages couldn&apos;t be loaded. Please refresh and try again.
        </p>
      )}

      <MailInbox userId={user.id} items={items} />
    </div>
  );
}