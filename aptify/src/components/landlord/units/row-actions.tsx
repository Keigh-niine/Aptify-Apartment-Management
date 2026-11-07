"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { RowKind } from "@/lib/units";
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
        <ConfirmDialog
          title="Remove this tenant?"
          body={`${tenantName ?? "This tenant"} will lose access to ${label} and the lease will end today. Bills and payment history are kept.`}
          confirmLabel="Remove tenant"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => run("remove_tenant", { p_lease: leaseId }, "Tenant removed.")}
        />
      )}
    </>
  );
}
