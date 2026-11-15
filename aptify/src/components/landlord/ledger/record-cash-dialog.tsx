"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, Labeled, MoneyInput } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import { monthTitle, receiptNo, todayLocal, type LedgerRow } from "@/lib/ledger";
import { shortLabel } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney, parseMoney } from "@/lib/units";
import { Modal } from "./modal";

export function RecordCashDialog({
  rows,
  nextReceipt,
  onClose,
}: {
  rows: LedgerRow[]; // bills that still have a balance and no payment waiting
  nextReceipt: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [billId, setBillId] = useState(rows[0]?.bill_id ?? "");
  const bill = rows.find((r) => r.bill_id === billId);
  const [amount, setAmount] = useState(rows[0] ? fmtMoney(Number(rows[0].balance)) : "");
  const [receivedOn, setReceivedOn] = useState(todayLocal);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function chooseBill(id: string) {
    setBillId(id);
    const r = rows.find((x) => x.bill_id === id);
    if (r) setAmount(fmtMoney(Number(r.balance)));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bill) return;

    const amountNum = parseMoney(amount);
    if (amountNum === null || amountNum <= 0) {
      setError("Enter the amount received.");
      return;
    }
    if (amountNum > Number(bill.balance) + 0.005) {
      setError(`That is more than the balance of ${formatPeso(Number(bill.balance))}.`);
      return;
    }
    if (!receivedOn) {
      setError("Pick the date you received it.");
      return;
    }

    setError(null);
    setBusy(true);
    const { error: rpcError } = await createClient().rpc("record_cash_payment", {
      p_bill: bill.bill_id,
      p_amount: amountNum,
      p_received_on: receivedOn,
      p_note: note.trim() || null,
    });
    setBusy(false);

    if (rpcError) {
      toast("err", "Something went wrong. Please try again.");
      return;
    }
    toast("ok", `Cash payment recorded. Receipt ${nextReceipt} created.`);
    onClose();
    router.refresh();
  }

  return (
    <Modal title="Record cash payment" onClose={onClose} busy={busy}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-slate-900">Record cash payment</h2>
        <p className="text-sm text-slate-500">Use this when a tenant pays you in person.</p>
      </div>

      {rows.length === 0 ? (
        <>
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            Every bill this month is paid, or already has a payment waiting for your review.
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Labeled
            label="Tenant"
            hint={bill ? `${monthTitle(bill.billing_period)} balance: ${formatPeso(Number(bill.balance))}` : undefined}
          >
            <select
              value={billId}
              onChange={(e) => chooseBill(e.target.value)}
              className={inputClass()}
            >
              {rows.map((r) => (
                <option key={r.bill_id} value={r.bill_id}>
                  {r.tenant_name} · Unit {shortLabel(r.unit_label)}
                  {r.bill_type === "move_in" ? " · Move-in" : ""}
                </option>
              ))}
            </select>
          </Labeled>

          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Amount">
              <MoneyInput
                label="Amount"
                value={amount}
                invalid={!!error && /amount|balance/i.test(error)}
                onChange={setAmount}
              />
            </Labeled>
            <Labeled label="Date received">
              <input
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
                className={inputClass()}
              />
            </Labeled>
          </div>

          <Labeled label="Note (optional)">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Paid at the office"
              className={inputClass()}
            />
          </Labeled>

          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
            A receipt is created automatically:{" "}
            <span className="font-semibold text-slate-900">{nextReceipt}</span>
          </p>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
