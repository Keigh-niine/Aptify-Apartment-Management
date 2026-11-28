// Notifications a tenant can receive. (Landlords get other types in the same table.)
export const TENANT_NOTIFICATION_TYPES = [
  "rent_reminder",
  "bill_issued",
  "payment_received",
  "cash_rejected",
  "repair_update",
  "announcement",
] as const;

export type TenantNotificationType = (typeof TENANT_NOTIFICATION_TYPES)[number];

// Announcements come from their own list in Mail, so their notification rows are not listed twice
export const MAIL_NOTIFICATION_TYPES = TENANT_NOTIFICATION_TYPES.filter((t) => t !== "announcement");

export type TenantNotification = {
  id: string;
  type: TenantNotificationType;
  title: string;
  body: string | null;
  payment_id: string | null;
  bill_id: string | null;
  maintenance_request_id: string | null;
  read_at: string | null;
  created_at: string;
};

// One row in the Mail inbox: an announcement or a notification
export type MailItem = {
  key: string;
  kind: "announcement" | "notification";
  id: string; // the announcement's id, or the notification's id
  sender: string;
  subject: string;
  body: string;
  date: string;
  unread: boolean;
  action?: { href: string; label: string }; // button shown when the message is open
};

// Who the message appears to be from
export const notificationSender: Record<TenantNotificationType, string> = {
  rent_reminder: "Landlord",
  bill_issued: "Billing",
  payment_received: "Payments",
  cash_rejected: "Payments",
  repair_update: "Maintenance",
  announcement: "Landlord",
};

// The button shown inside an opened message
export function notificationAction(n: TenantNotification): { href: string; label: string } | undefined {
  switch (n.type) {
    case "payment_received":
      return n.payment_id
        ? { href: `/tenant/payments/receipts/${n.payment_id}`, label: "View receipt" }
        : { href: "/tenant/payments", label: "Go to Payments" };
    case "repair_update":
      return n.maintenance_request_id
        ? { href: `/tenant/maintenance/${n.maintenance_request_id}`, label: "View request" }
        : { href: "/tenant/maintenance", label: "Go to Maintenance" };
    case "announcement":
      return undefined;
    default: // rent_reminder, bill_issued, cash_rejected
      return { href: "/tenant/payments", label: "Go to Payments" };
  }
}