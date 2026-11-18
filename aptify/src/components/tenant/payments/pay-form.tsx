"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { inputClass, Labeled, MoneyInput } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/format";
import { monthTitle } from "@/lib/ledger";
import { formatPhone } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import {
  providerLabel,
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
  type PayAccount,
  type PayBill,
} from "@/lib/tenant-payments";
import { fmtMoney, parseMoney } from "@/lib/units";

type Method = "online" | "cash";
type Provider = "gcash" | "maya";

const radioCard =
  "flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 py-3.5 has-[:checked]:border-sky-700 has-[:checked]:bg-sky-50";
const radioDot =
  "size-4 shrink-0 rounded-full border-[1.5px] border-slate-300 bg-white peer-checked:border-[5px] peer-checked:border-sky-700";

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className={bold ? "font-semibold text-slate-900" : "text-slate-500"}>{label}</span>
      <span className={`text-right text-slate-900 ${bold ? "font-bold" : "font-semibold"}`}>{value}</span>
    </div>
  );
}

export function PayForm({
  userId,
  bill,
  accounts,
  initialMethod,
  dueText,
  defaultPlanned,
}: {
  userId: string;
  bill: PayBill;
  accounts: PayAccount[];
  initialMethod: Method;
  dueText: string;
  defaultPlanned: string; // YYYY-MM-DD, from the server so both sides agree
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const balance = Number(bill.balance);
  const providers = (["gcash", "maya"] as Provider[]).filter((p) => accounts.some((a) => a.method === p));

  const [amountMode, setAmountMode] = useState<"full" | "custom">("full");
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<Method>(initialMethod);
  const [provider, setProvider] = useState<Provider>(providers[0] ?? "gcash");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [planned, setPlanned] = useState(defaultPlanned);
  const [errors, setErrors] = useState<{ amount?: string; receipt?: string; planned?: string }>({});
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.method === provider);
  const customNum = parseMoney(custom);
  const amount = amountMode === "full" ? balance : (customNum ?? 0);
  const month = monthTitle(bill.billing_period);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!RECEIPT_TYPES[f.type]) {
      setErrors((e) => ({ ...e, receipt: "Use a PNG, JPG or WebP image." }));
      return;
    }
    if (f.size > RECEIPT_MAX_BYTES) {
      setErrors((e) => ({ ...e, receipt: "The image must be 5 MB or smaller." }));
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setErrors((e) => ({ ...e, receipt: undefined }));
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function removeFile() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  }

  async function copyNumber() {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.account_number);
      toast("info", "Number copied.");
    } catch {
      toast("err", "Couldn't copy. Select the number and copy it yourself.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const found: typeof errors = {};
    if (amountMode === "custom") {
      if (customNum === null || customNum <= 0) found.amount = "Enter the amount you are paying.";
      else if (customNum > balance + 0.005) found.amount = `That is more than the balance of ${formatPeso(balance)}.`;
    }
    if (method === "online" && !file) found.receipt = "Upload your receipt so your landlord can check it.";
    if (method === "cash" && !planned) found.planned = "Pick the date you plan to pay.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const supabase = createClient();
    let receiptPath: string | null = null;

    // Online: the receipt screenshot goes to the private bucket first
    if (method === "online" && file) {
      receiptPath = `${userId}/${Date.now()}.${RECEIPT_TYPES[file.type]}`;
      const up = await supabase.storage
        .from("payment-receipts")
        .upload(receiptPath, file, { contentType: file.type, upsert: false });
      if (up.error) {
        toast("err", "Couldn't upload your receipt. Please try again.");
        setBusy(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        bill_id: bill.bill_id,
        payer_id: userId,
        amount,
        method: method === "cash" ? "cash" : provider,
        status: "pending",
        planned_date: method === "cash" ? planned : null,
        reference_no: method === "online" ? reference.trim() || null : null,
        note: note.trim() || null,
        receipt_path: receiptPath,
      })
      .select("id")
      .single();

    if (error || !data) {
      if (receiptPath) await supabase.storage.from("payment-receipts").remove([receiptPath]);
      toast(
        "err",
        "Couldn't send your payment. A payment for this bill may already be waiting for your landlord."
      );
      setBusy(false);
      return;
    }

    router.push(`/tenant/payments/submitted/${data.id}`);
    router.refresh();
  }

  const steps =
    method === "cash"
      ? [
          ["You send the notice", "Status: Pending cash"],
          ["Your landlord confirms they received it", "You are notified"],
          ["Receipt is issued", "Download it from Payments"],
        ]
      : [
          ["Send the payment", `Pay in ${providerLabel[provider]} using the QR or number`],
          ["Upload your receipt", "Attach a screenshot of the confirmation"],
          ["Your landlord confirms", "You get an official receipt once they do"],
        ];

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-5">
        {/* The bill */}
        <section className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-bold text-slate-900">{month} bill</h2>
              <p className="text-xs text-slate-500">Due {new Date(bill.due_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>
            </div>
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              {dueText}
            </span>
          </div>
          {bill.items.map((it) => (
            <Row key={it.description} label={it.description} value={formatPeso(Number(it.amount))} />
          ))}
          {Number(bill.discount) > 0 && <Row label="Discount" value={`− ${formatPeso(Number(bill.discount))}`} />}
          <div className="my-1.5 h-px bg-slate-200" />
          <Row label="Total due" value={formatPeso(Number(bill.total_due))} bold />
          {Number(bill.paid) > 0 && (
            <>
              <Row label="Already paid" value={formatPeso(Number(bill.paid))} />
              <Row label="Balance" value={formatPeso(balance)} bold />
            </>
          )}
        </section>

        {/* Pay your bill */}
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Pay your bill</h2>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium text-slate-900">Amount</legend>
            <label className={radioCard}>
              <input type="radio" name="amount" className="peer sr-only" checked={amountMode === "full"} onChange={() => setAmountMode("full")} />
              <span className={radioDot} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-slate-900">Pay full balance</span>
                <span className="text-xs text-slate-500">{formatPeso(balance)}</span>
              </span>
            </label>
            <label className={radioCard}>
              <input type="radio" name="amount" className="peer sr-only" checked={amountMode === "custom"} onChange={() => { setAmountMode("custom"); if (!custom) setCustom(fmtMoney(balance)); }} />
              <span className={radioDot} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-slate-900">Pay a custom amount</span>
                <span className="text-xs text-slate-500">Partial payments are allowed</span>
              </span>
            </label>
            {amountMode === "custom" && (
              <Labeled label="Amount" error={errors.amount}>
                <MoneyInput label="Amount" value={custom} placeholder="0.00" invalid={!!errors.amount} onChange={setCustom} />
              </Labeled>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium text-slate-900">Method</legend>
            <label className={radioCard}>
              <input type="radio" name="method" className="peer sr-only" checked={method === "online"} onChange={() => setMethod("online")} />
              <span className={radioDot} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-slate-900">GCash or Maya</span>
                <span className="text-xs text-slate-500">Pay by QR, then upload your receipt</span>
              </span>
            </label>
            <label className={radioCard}>
              <input type="radio" name="method" className="peer sr-only" checked={method === "cash"} onChange={() => setMethod("cash")} />
              <span className={radioDot} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-slate-900">Cash</span>
                <span className="text-xs text-slate-500">Your landlord will confirm once you hand it over</span>
              </span>
            </label>
          </fieldset>

          {/* ---------- Online ---------- */}
          {method === "online" && (
            <>
              {providers.length === 0 ? (
                <p className="rounded-xl bg-amber-100 p-4 text-sm font-medium text-amber-800">
                  Your landlord hasn&apos;t set up GCash or Maya yet. Pay with cash, or ask your landlord to add their details.
                </p>
              ) : (
                <>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1.5 text-[13px] font-medium text-slate-900">Pay with</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["gcash", "maya"] as Provider[]).map((p) => {
                        const available = providers.includes(p);
                        return (
                          <label key={p} className={`${radioCard} ${available ? "" : "cursor-not-allowed opacity-50"}`}>
                            <input type="radio" name="provider" className="peer sr-only" disabled={!available} checked={provider === p} onChange={() => setProvider(p)} />
                            <span className={radioDot} />
                            <span className="flex flex-col gap-0.5">
                              <span className="text-sm font-semibold text-slate-900">{providerLabel[p]}</span>
                              <span className="text-xs text-slate-500">{available ? `Scan the QR in ${providerLabel[p]}` : "Not set up by your landlord"}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  {account && (
                    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row">
                      <div className="flex size-[160px] shrink-0 items-center justify-center self-center rounded-xl border border-slate-200 bg-white sm:self-start">
                        {account.qr_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={account.qr_url} alt={`${providerLabel[provider]} QR code`} className="size-full rounded-xl object-contain p-1" />
                        ) : (
                          <span className="px-3 text-center text-xs text-slate-500">No QR uploaded. Use the number.</span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <div>
                          <p className="text-xs text-slate-500">Account name</p>
                          <p className="text-[15px] font-semibold text-slate-900">{account.account_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Mobile number</p>
                          <p className="text-[15px] font-semibold text-slate-900">{formatPhone(account.account_number)}</p>
                          <button type="button" onClick={copyNumber} className="cursor-pointer text-[13px] font-semibold text-sky-700 hover:underline">
                            Copy number
                          </button>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Amount to send</p>
                          <p className="text-xl font-bold text-slate-900">{formatPeso(amount)}</p>
                        </div>
                        <p className="text-xs text-slate-500">Send exactly this amount so your landlord can match your payment.</p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] font-medium text-slate-900">Upload your receipt</p>
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload receipt" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
                    {file && preview ? (
                      <div className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preview} alt="Your receipt" className="h-[72px] w-[56px] rounded-lg border border-slate-200 bg-white object-cover" />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <p className="truncate text-sm font-semibold text-slate-900">{file.name}</p>
                          <p className="text-xs text-slate-500">{Math.max(1, Math.round(file.size / 1024))} KB · Ready to send</p>
                        </div>
                        <div className="flex gap-3 text-[13px] font-semibold">
                          <button type="button" onClick={() => fileInput.current?.click()} className="cursor-pointer text-sky-700 hover:underline">Replace</button>
                          <button type="button" onClick={removeFile} className="cursor-pointer text-red-700 hover:underline">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => fileInput.current?.click()} className={`flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed bg-slate-50 text-center transition-colors hover:bg-slate-100 ${errors.receipt ? "border-red-600" : "border-slate-300"}`}>
                        <span className="text-sm font-semibold text-sky-700">Upload your {providerLabel[provider]} receipt</span>
                        <span className="text-xs text-slate-500">A screenshot of the payment confirmation. PNG or JPG, up to 5 MB.</span>
                      </button>
                    )}
                    {errors.receipt && <p className="text-xs text-red-600">{errors.receipt}</p>}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Labeled label="Reference number (optional)">
                      <input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 7421 8890 3" className={inputClass()} />
                    </Labeled>
                    <Labeled label="Note (optional)">
                      <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sent at 3:40 PM" className={inputClass()} />
                    </Labeled>
                  </div>
                </>
              )}
            </>
          )}

          {/* ---------- Cash ---------- */}
          {method === "cash" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Planned date" error={errors.planned}>
                  <input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} className={inputClass(!!errors.planned)} />
                </Labeled>
                <Labeled label="Pay to">
                  <input value="Landlord (in person)" readOnly tabIndex={-1} className={inputClass()} />
                </Labeled>
              </div>
              <Labeled label="Note (optional)">
                <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I will pay at the office after 5:00 PM" className={inputClass()} />
              </Labeled>
            </>
          )}

          <div className="rounded-xl bg-amber-100 p-4">
            <p className="text-sm font-semibold text-amber-800">Your payment is not counted yet</p>
            <p className="mt-0.5 text-xs text-amber-800">
              {method === "cash"
                ? "It counts once your landlord confirms they received the cash. You will then get a receipt."
                : "It counts once your landlord checks your receipt and confirms the money arrived. You will then get an official receipt."}
            </p>
          </div>

          <div className="flex gap-2.5">
            <Button type="submit" disabled={busy || (method === "online" && providers.length === 0)}>
              {busy ? "Sending…" : method === "cash" ? "Notify landlord" : "Send to landlord"}
            </Button>
            <Link href="/tenant/payments" className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50">
              Cancel
            </Link>
          </div>
        </section>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 text-lg font-bold text-slate-900">Summary</h2>
          <Row label={`${month} bill`} value={formatPeso(Number(bill.total_due))} />
          <Row label="Paying now" value={formatPeso(amount)} bold />
          <Row label="Method" value={method === "cash" ? "Cash" : providerLabel[provider]} />
          {method === "cash" ? (
            <Row label="Planned date" value={planned ? new Date(planned + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"} />
          ) : (
            <Row label="Receipt" value={file ? "Attached" : "Not uploaded"} />
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">{method === "cash" ? "After you notify your landlord" : "After you send it"}</h2>
          {steps.map(([title, sub], i) => (
            <div key={title} className="flex items-start gap-3">
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i === 0 || (method === "online" && i === 1 && file) ? "bg-sky-700 text-white" : "border border-slate-300 bg-white"}`}>
                {i === 0 || (method === "online" && i === 1 && file) ? "✓" : ""}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500">{sub}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </form>
  );
}
