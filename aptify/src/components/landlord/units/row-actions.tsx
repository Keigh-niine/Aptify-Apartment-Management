"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { RowKind } from "@/lib/units";
import { DangerDialog } from "@/components/ui/danger-dialog";
import { removeStorageFiles, type FilePaths } from "@/lib/account";
import { ConfirmDialog } from "./confirm-dialog";

type Props = {
  kind: RowKind;
  unitId: string;
  label: string;
  tenantName: string | null;
  leaseId: string | null;
  inviteId: string | null;
  code: string | null;
};

export function RowActions({ kind, unitId, label, tenantName, leaseId, inviteId, code }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "revoke" | "remove">(null);
  const [busy, setBusy] = useState(false);

  async function run(rpc: string, args: Record<string, string>, okMessage: string) {
    setBusy(true);
    const { error } = await createClient().rpc(rpc, args);
    setBusy(false);
    if (error) {
      toast("err", "Something went wrong. Please try again.");
      return;
    }
    setDialog(null);
    toast("ok", okMessage);
    router.refresh();
  }

  // Remove the tenant and delete their account and records (permanent)
  async function removeAndDelete() {
    if (!leaseId) return;
    setBusy(true);
    const supabase = createClient();

    // Files first (repair photos), best effort
    const { data: files } = await supabase.rpc("tenant_file_paths", { p_lease: leaseId });
    await removeStorageFiles(supabase, files as FilePaths);

    const { data, error } = await supabase.rpc("remove_tenant_and_account", { p_lease: leaseId });
    setBusy(false);
    if (error) {
      toast("err", "Something went wrong. Please try again.");
      return;
    }
    setDialog(null);
    toast(
      "ok",
      data?.account_deleted
        ? "Tenant removed and their account deleted."
        : "Tenant removed. Their account was kept because they also use Aptify elsewhere, but all their records with you were deleted."
    );
    router.refresh();
  }

  if (kind === "vacant") {
    return (
      <Link
        href={`/landlord/units/invite?unit=${unitId}`}
        className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-3.5 py-[7px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
      >
        Generate invite
      </Link>
    );
  }

  return (
    <>
      {kind === "occupied" ? (
        <Button size="sm" variant="outline" onClick={() => setDialog("remove")}>
          Remove tenant
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setDialog("revoke")}>
          Revoke
        </Button>
      )}

      {dialog === "revoke" && inviteId && (
        <ConfirmDialog
          title="Revoke this invite?"
          body={`The code ${code} will stop working right away. You can generate a new invite for ${label} at any time.`}
          confirmLabel="Revoke invite"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => run("revoke_invite", { p_invite: inviteId }, "Invite revoked.")}
        />
      )}

      {dialog === "remove" && leaseId && (
        <DangerDialog
          title={`Remove and delete ${tenantName ?? "this tenant"}?`}
          intro={`${tenantName ?? "This tenant"} will be removed from ${label} and their account will be deleted. This can't be undone.`}
          items={[
            "Their account and login",
            "Their lease, bills, payments and receipts",
            "Their repair requests, photos and comments",
          ]}
          note="If this person also owns a property or rents from another landlord, their account is kept and only their records with you are deleted."
          confirmLabel="Remove and delete"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={removeAndDelete}
        />
      )}
    </>
  );
}
