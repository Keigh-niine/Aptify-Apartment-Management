"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { NotificationsCard, type Prefs } from "./notifications-card";
import { PasswordCard } from "./password-card";
import { ProfileCard } from "./profile-card";
import { SettingsCard } from "./settings-card";

function AccountCard() {
  const router = useRouter();

  return (
    <SettingsCard title="Account" gap="gap-3">
      <div>
        <Button
          variant="outline"
          onClick={async () => {
            await createClient().auth.signOut();
            router.push("/login");
            router.refresh();
          }}
        >
          Log out
        </Button>
      </div>
    </SettingsCard>
  );
}

export function SettingsView({
  role,
  userId,
  email,
  profile,
  prefs,
}: {
  role: "landlord" | "tenant";
  userId: string;
  email: string;
  profile: { firstName: string; lastName: string; phone: string };
  prefs: Prefs;
}) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <ProfileCard userId={userId} initial={{ ...profile, email }} />
        <NotificationsCard userId={userId} initial={prefs} role={role} />
      </div>
      <div className="flex flex-col gap-5">
        <PasswordCard email={email} />
        <AccountCard />
      </div>
    </div>
  );
}
