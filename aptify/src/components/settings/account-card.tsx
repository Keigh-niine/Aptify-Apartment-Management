"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { DangerDialog } from "@/components/ui/danger-dialog";
import { removeStorageFiles, type FilePaths } from "@/lib/account";
import { createClient } from "@/lib/supabase/client";
import { SettingsCard } from "./settings-card";

const copy = {
  landlord: {
    intro:
      "This permanently deletes your account and everything tied to it. Your tenants keep their accounts, but they lose their unit and their payment history.",
    items: [
      "Your profile and login",
      "All your properties, units and leases",
      "All bills, payments and receipts, including your tenants' payment history",
      "Repair requests, announcements and your payment QR codes",
    ],
  },
  tenant: {
    intro:
      "This permanently deletes your account and everything tied to it. Your landlord will no longer see your payment history.",
    items: [
      "Your profile and login",
      "Your lease, bills, payments and receipts",
      "Your repair requests, photos and comments",
    ],
  },
};

export function AccountCard({ role }: { role: "landlord" | "tenant" }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function deleteAccount() {
    setBusy(true);
    const supabase = createClient();

    // 1) Remove uploaded files (QR codes and repair photos), best effort
    const { data: files } = await supabase.rpc("my_file_paths");
    await removeStorageFiles(supabase, files as FilePaths);

    // 2) Delete everything in the database, including the login
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      toast("err", "Couldn't delete your account. Please try again.");
      setBusy(false);
      return;
    }

    // 3) Clear this browser's session and leave
    await supabase.auth.signOut({ scope: "local" });
    router.push("/");
    router.refresh();
  }

  return (
    <SettingsCard title="Account" gap="gap-3">
      <p className="-mt-1.5 text-[13px] text-slate-500">
        Permanently delete your account and everything tied to it.
      </p>
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-red-300 bg-white px-5 py-[11px] text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
        >
          Delete account
        </button>
      </div>

      {open && (
        <DangerDialog
          title="Delete your account?"
          intro={copy[role].intro}
          items={copy[role].items}
          confirmLabel="Delete my account"
          busy={busy}
          onConfirm={deleteAccount}
          onCancel={() => setOpen(false)}
        />
      )}
    </SettingsCard>
  );
}
