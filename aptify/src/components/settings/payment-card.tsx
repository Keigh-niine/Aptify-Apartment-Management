"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field } from "@/components/auth/field";
import { useToast } from "@/components/toast";
import {
  formatPhone,
  isValidPhone,
  normalizePhone,
  payMethods,
  QR_MAX_BYTES,
  QR_TYPES,
  type PayMethod,
  type PaymentAccountView,
} from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "./settings-card";

type Form = {
  name: string;
  number: string;
  qrUrl: string | null; // what is shown: the saved image or a local preview
  file: File | null; // a newly picked image that is not uploaded yet
  removeQr: boolean;
};

type Errors = Partial<Record<PayMethod, { name?: string; number?: string; qr?: string }>>;
type Saved = Record<PayMethod, PaymentAccountView | undefined>;

export function PaymentCard({
  userId,
  accounts,
  loadError,
}: {
  userId: string;
  accounts: PaymentAccountView[];
  loadError?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInputs = useRef<Partial<Record<PayMethod, HTMLInputElement | null>>>({});

  // What is stored in the database right now (kept up to date after each save)
  const [saved, setSaved] = useState<Saved>(() => ({
    gcash: accounts.find((a) => a.method === "gcash"),
    maya: accounts.find((a) => a.method === "maya"),
  }));

  const [forms, setForms] = useState<Record<PayMethod, Form>>(() => {
    const make = (m: PayMethod): Form => {
      const a = accounts.find((x) => x.method === m);
      return {
        name: a?.account_name ?? "",
        number: a ? formatPhone(a.account_number) : "",
        qrUrl: a?.qr_url ?? null,
        file: null,
        removeQr: false,
      };
    };
    return { gcash: make("gcash"), maya: make("maya") };
  });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const patch = (m: PayMethod, p: Partial<Form>) =>
    setForms((f) => ({ ...f, [m]: { ...f[m], ...p } }));

  const setQrError = (m: PayMethod, message?: string) =>
    setErrors((e) => ({ ...e, [m]: { ...e[m], qr: message } }));

  function pickFile(m: PayMethod, file: File | undefined) {
    if (!file) return;
    if (!QR_TYPES[file.type]) {
      setQrError(m, "Use a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > QR_MAX_BYTES) {
      setQrError(m, "The image must be 2 MB or smaller.");
      return;
    }
    const old = forms[m].qrUrl;
    if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
    setQrError(m, undefined);
    patch(m, { file, qrUrl: URL.createObjectURL(file), removeQr: false });
  }

  function removeQr(m: PayMethod) {
    const old = forms[m].qrUrl;
    if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
    patch(m, { file: null, qrUrl: null, removeQr: true });
  }

  const isUsed = (f: Form) => !!(f.name.trim() || f.number.trim() || f.file || f.qrUrl);

  async function save() {
    // 1) Check what was typed
    const found: Errors = {};
    for (const { value: m } of payMethods) {
      const f = forms[m];
      if (!isUsed(f)) continue;
      const e: { name?: string; number?: string } = {};
      if (f.name.trim().length < 2) e.name = "Enter the account name.";
      if (!isValidPhone(normalizePhone(f.number))) {
        e.number = "Enter an 11-digit mobile number, like 0917 123 4567.";
      }
      if (e.name || e.number) found[m] = e;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // 2) Save each method
    setSaving(true);
    const supabase = createClient();
    const bucket = supabase.storage.from("payment-qr");

    try {
      for (const { value: m } of payMethods) {
        const f = forms[m];
        const existing = saved[m];

        // Cleared completely: remove the row and its image
        if (!isUsed(f)) {
          if (existing) {
            const { error } = await supabase
              .from("payment_accounts")
              .delete()
              .eq("owner_id", userId)
              .eq("method", m);
            if (error) throw error;
            if (existing.qr_path) await bucket.remove([existing.qr_path]);
            setSaved((s) => ({ ...s, [m]: undefined }));
          }
          continue;
        }

        const oldPath = existing?.qr_path ?? null;
        let qrPath = oldPath;

        if (f.file) {
          // New file name each time, so a replaced image never shows a stale copy
          qrPath = `${userId}/${m}-${Date.now()}.${QR_TYPES[f.file.type]}`;
          const { error } = await bucket.upload(qrPath, f.file, {
            contentType: f.file.type,
            upsert: false,
          });
          if (error) throw error;
        } else if (f.removeQr) {
          qrPath = null;
        }

        const number = normalizePhone(f.number);
        const { error } = await supabase.from("payment_accounts").upsert(
          {
            owner_id: userId,
            method: m,
            account_name: f.name.trim(),
            account_number: number,
            qr_path: qrPath,
          },
          { onConflict: "owner_id,method" }
        );
        if (error) throw error;

        // Only after the row points at the new image, delete the old one
        if (oldPath && oldPath !== qrPath) await bucket.remove([oldPath]);

        setSaved((s) => ({
          ...s,
          [m]: {
            method: m,
            account_name: f.name.trim(),
            account_number: number,
            qr_path: qrPath,
            qr_url: f.qrUrl,
          },
        }));
        patch(m, { file: null, removeQr: false, number: formatPhone(number) });
      }

      toast("ok", "Payment details saved.");
      router.refresh();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      toast(
        "err",
        code === "42P01"
          ? "Payment details aren't set up in your database yet. Run 006_payment_accounts.sql in Supabase."
          : "Couldn't save your payment details. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="Payment details">
      <p className="-mt-2.5 text-[13px] text-slate-500">
        Tenants see these details when they pay by GCash or Maya. They send the money, enter the
        reference number, and you confirm it in the rent ledger.
      </p>

      {loadError && (
        <p role="alert" className="rounded-xl bg-red-100 p-3 text-sm font-medium text-red-800">
          {loadError}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {payMethods.map(({ value: m, label }) => {
          const f = forms[m];
          const err = errors[m] ?? {};
          const active = !!saved[m];

          return (
            <div
              key={m}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-bold text-slate-900">{label}</p>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {active ? "Active" : "Not set up"}
                </span>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <Field
                    label="Account name"
                    placeholder="Name on the account"
                    autoComplete="off"
                    value={f.name}
                    onChange={(e) => patch(m, { name: e.target.value })}
                    error={err.name}
                  />
                  <Field
                    label="Mobile number"
                    type="tel"
                    inputMode="tel"
                    placeholder="09XX XXX XXXX"
                    autoComplete="off"
                    value={f.number}
                    onChange={(e) => patch(m, { number: e.target.value })}
                    onBlur={() => {
                      const n = normalizePhone(f.number);
                      if (isValidPhone(n)) patch(m, { number: formatPhone(n) });
                    }}
                    error={err.number}
                  />
                </div>

                <div className="flex flex-col items-center gap-2 sm:w-[132px] sm:shrink-0">
                  <p className="text-[13px] font-medium text-slate-900">QR code</p>

                  <input
                    ref={(el) => {
                      fileInputs.current[m] = el;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label={`${label} QR code image`}
                    onChange={(e) => {
                      pickFile(m, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />

                  {f.qrUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.qrUrl}
                        alt={`${label} QR code`}
                        className="size-[132px] rounded-xl border border-slate-200 bg-white object-contain p-1"
                      />
                      <div className="flex gap-2.5 text-[13px] font-semibold">
                        <button
                          type="button"
                          onClick={() => fileInputs.current[m]?.click()}
                          className="cursor-pointer text-sky-700 hover:underline"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQr(m)}
                          className="cursor-pointer text-red-700 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputs.current[m]?.click()}
                        className="flex size-[132px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-slate-300 bg-white px-2 text-center transition-colors hover:bg-slate-100"
                      >
                        <span className="text-[22px] font-medium leading-none text-sky-700">+</span>
                        <span className="text-[13px] font-semibold text-sky-700">Upload QR</span>
                        <span className="text-[11px] text-slate-500">PNG or JPG, up to 2 MB</span>
                      </button>
                      <p className="text-xs text-slate-500">Not uploaded</p>
                    </>
                  )}
                </div>
              </div>

              {err.qr && <p className="text-xs text-red-600">{err.qr}</p>}
            </div>
          );
        })}
      </div>

      <div>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save payment details"}
        </Button>
      </div>
    </SettingsCard>
  );
}
