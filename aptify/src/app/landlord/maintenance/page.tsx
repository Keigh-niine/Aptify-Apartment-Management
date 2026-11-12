import { SettingsView } from "@/components/settings/settings-view";
import { getLandlordContext } from "@/lib/landlord";
import type { PayMethod, PaymentAccountView } from "@/lib/payments";

export const instant = false;

export default async function SettingsPage() {
  const { supabase, user } = await getLandlordContext();

  const [{ data: profile }, { data: prefs }, paymentsRes] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name, phone").eq("id", user.id).single(),
    supabase
      .from("notification_preferences")
      .select("rent_reminders, repair_updates, announcements")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("payment_accounts")
      .select("method, account_name, account_number, qr_path")
      .eq("owner_id", user.id),
  ]);

  // The QR bucket is private, so each image needs a temporary link.
  const rows = (paymentsRes.data ?? []) as {
    method: PayMethod;
    account_name: string;
    account_number: string;
    qr_path: string | null;
  }[];

  const paths = rows.map((r) => r.qr_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("payment-qr").createSignedUrls(paths, 3600);
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    });
  }

  const payments: PaymentAccountView[] = rows.map((r) => ({
    ...r,
    qr_url: r.qr_path ? (urls.get(r.qr_path) ?? null) : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] font-bold text-slate-900">Settings</h1>
        <p className="text-[15px] text-slate-500">Manage your account</p>
      </div>

      <SettingsView
        role="landlord"
        userId={user.id}
        email={user.email ?? ""}
        profile={{
          firstName: profile?.first_name ?? "",
          lastName: profile?.last_name ?? "",
          phone: profile?.phone ?? "",
        }}
        prefs={{
          rent_reminders: prefs?.rent_reminders ?? true,
          repair_updates: prefs?.repair_updates ?? true,
          announcements: prefs?.announcements ?? true,
        }}
        payments={payments}
        paymentsError={
          paymentsRes.error
            ? "Couldn't load your payment details. Make sure you ran 006_payment_accounts.sql in Supabase."
            : undefined
        }
      />
    </div>
  );
}
