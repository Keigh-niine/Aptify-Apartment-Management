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

// Where tapping a notification takes the tenant
export function notificationHref(n: TenantNotification): string {
  switch (n.type) {
    case "payment_received":
      return n.payment_id ? `/tenant/payments/receipts/${n.payment_id}` : "/tenant/payments";
    case "repair_update":
      return n.maintenance_request_id
        ? `/tenant/maintenance/${n.maintenance_request_id}`
        : "/tenant/maintenance";
    case "announcement":
      return "/tenant/announcements";
    default: // rent_reminder, bill_issued, cash_rejected
      return "/tenant/payments";
  }
}

export const notificationLabel: Record<TenantNotificationType, string> = {
  rent_reminder: "Reminder",
  bill_issued: "New bill",
  payment_received: "Payment",
  cash_rejected: "Payment",
  repair_update: "Repair",
  announcement: "Announcement",
};