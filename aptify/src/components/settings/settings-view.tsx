"use client";

import type { PaymentAccountView } from "@/lib/payments";
import { AccountCard } from "./account-card";
import { NotificationsCard, type Prefs } from "./notifications-card";
import { PasswordCard } from "./password-card";
import { PaymentCard } from "./payment-card";
import { ProfileCard } from "./profile-card";

export function SettingsView({
  role,
  userId,
  email,
  profile,
  prefs,
  payments,
  paymentsError,
}: {
  role: "landlord" | "tenant";
  userId: string;
  email: string;
  profile: { firstName: string; lastName: string; phone: string };
  prefs: Prefs;
  // Landlords only: their GCash / Maya details
  payments?: PaymentAccountView[];
  paymentsError?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <ProfileCard userId={userId} initial={{ ...profile, email }} />
          <NotificationsCard userId={userId} initial={prefs} role={role} />
        </div>
        <div className="flex flex-col gap-5">
          <PasswordCard email={email} />
          <AccountCard role={role} />
        </div>
      </div>

      {role === "landlord" && (
        <PaymentCard userId={userId} accounts={payments ?? []} loadError={paymentsError} />
      )}
    </div>
  );
}
