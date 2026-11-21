"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { formatDate, formatPeso } from "@/lib/format";
import {
  formatDateTime,
  methodLabel,
  monthTitle,
  todayLocal,
  type BillLedgerRow,
} from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "./modal";

type Reason = "not_received" | "wrong_amount" | "other";

const reasons: { value: Reason; label: string }[] = [
  { value: "not_received", label: "I did not receive the money" },
  { value: "wrong_amount", label: "The amount is different" },
  { value: "other", label: "Other" },
];

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}

export function ReviewPaymentDialog({
  row,
  onClose,
}: {
  row: BillLedgerRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const pay = row.pending!;
  const isCash = pay.method === "cash";

  const [mode, setMode] = useState<"review" | "reject">("review");
  const [receivedOn, setReceivedOn] = useState(todayLocal);
  const [reason, setReason] = useState<Reason>("not_received");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const who = `${row.tenant_name} · Unit ${shortLabel(row.unit_label)}`;
  const differs = Math.abs(Number(pay.amount) - Number(row.balance)) > 0.005;

  async function run(rpc: string, args: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    const { error } = await createClient().rpc(rpc, args);
    setBusy(false);

    if (error) {
      toast(
        "err",
        error.message.includes("payment_not_pending")
          ? "This payment was already reviewed."
          : "Something went wrong. Please try again."
      );
      if (error.message.includes("payment_not_pending")) {
        onClose();
        router.refresh();
      }
      return;
    }
    toast("ok", okMessage);
    onClose();
    router.refresh();
  }

  // ---------- Reject ----------
  if (mode === "reject") {
    return (
      <Modal title="Reject payment" onClose={onClose} busy={busy}>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-slate-900">Reject payment</h2>
          <p className="text-sm text-slate-500">
            {who} · {formatPeso(Number(pay.amount))}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-slate-900">Reason</legend>
          {reasons.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-slate-300 bg-white px-3.5 py-3 has-[:checked]:border-sky-700 has-[:checked]:bg-sky-50"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="peer sr-only"
              />
              <span className="size-4 shrink-0 rounded-full border-[1.5px] border-slate-300 bg-white peer-checked:border-[5px] peer-checked:border-sky-700" />
              <span className="text-sm font-medium text-slate-900">{r.label}</span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">Message to tenant (optional)</span>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              isCash
                ? "e.g. Please bring the payment to the office"
                : "e.g. The receipt is unclear. Please send it again"
            }
            className={`${inputClass()} resize-none`}
          />
        </label>

        <p className="text-xs text-slate-500">The tenant is notified and the bill stays unpaid.</p>

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={() => setMode("review")} disabled={busy}>
            Back
          </Button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                "reject_payment",
                { p_payment: pay.payment_id, p_reason: reason, p_message: message.trim() || null },
                "Payment rejected. The tenant was notified."
              )
            }
            className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-red-600 px-5 py-[11px] text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Rejecting…" : "Reject payment"}
          </button>
        </div>
      </Modal>
    );
  }

  // ---------- Review ----------
  return (
    <Modal title="Review payment" onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-slate-900">Review payment</h2>
        <p className="text-sm text-slate-500">{who}</p>
      </div>

      <div className="flex flex-col rounded-xl bg-slate-50 p-4">
        <Info
          label="Bill"
          value={`${monthTitle(row.billing_period)}${row.bill_type === "move_in" ? " (move-in)" : ""}`}
        />
        <Info label="Amount sent" value={formatPeso(Number(pay.amount))} />
        <Info label="Bill balance" value={formatPeso(Number(row.balance))} />
        <Info label="Method" value={methodLabel[pay.method] ?? pay.method} />
        {!isCash && <Info label="Reference number" value={pay.reference_no || "Not provided"} />}
        {isCash && pay.planned_date && (
          <Info label="Planned date" value={formatDate(pay.planned_date)} />
        )}
        <Info label="Sent" value={formatDateTime(pay.created_at)} />
        {pay.note && <Info label="Note from tenant" value={pay.note} />}
      </div>

      {differs && (
        <p className="rounded-[10px] bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">
          The amount sent is different from the bill balance of {formatPeso(Number(row.balance))}.
        </p>
      )}

      {/* The receipt the tenant sent */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-slate-900">Receipt from tenant</p>
        {isCash ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            This is a cash payment, so there is no receipt image. Confirm only after you have
            received the money.
          </p>
        ) : pay.receipt_url ? (
          <a href={pay.receipt_url} target="_blank" rel="noreferrer" className="group block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pay.receipt_url}
              alt={`Receipt sent by ${row.tenant_name}`}
              className="max-h-72 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
            />
            <span className="mt-1 block text-xs font-semibold text-sky-700 group-hover:underline">
              Open full size
            </span>
          </a>
        ) : (
          <p className="rounded-[10px] bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">
            The receipt image could not be loaded. Check your own GCash or Maya app before
            confirming.
          </p>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-900">Date received</span>
        <input
          type="date"
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
          className={inputClass()}
        />
      </label>

      <p className="text-xs text-slate-500">
        Confirming marks the money as received and creates an official receipt for the tenant.
        Check your own {isCash ? "cash" : `${methodLabel[pay.method] ?? "payment"} account`} first.
      </p>

      <div className="flex flex-wrap justify-end gap-2.5">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode("reject")}
          className="inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-red-300 bg-white px-5 py-[11px] text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reject
        </button>
        <Button
          type="button"
          disabled={busy || !receivedOn}
          onClick={() =>
            run(
              "confirm_payment",
              { p_payment: pay.payment_id, p_received_on: receivedOn },
              "Payment confirmed. A receipt was created."
            )
          }
        >
          {busy ? "Confirming…" : "Confirm received"}
        </Button>
      </div>
    </Modal>
  );
}
