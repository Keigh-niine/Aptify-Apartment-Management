"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { OTP_LENGTH } from "@/lib/signup";

const RESEND_SECONDS = 60;

export function VerifyStep({
  email,
  onVerify,
  onResend,
  onBack,
}: {
  email: string;
  // Each returns an error message, or null on success.
  onVerify: (code: string) => Promise<string | null>;
  onResend: () => Promise<string | null>;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(value: string) {
    if (submitting.current || value.length !== OTP_LENGTH) return;
    submitting.current = true;
    setError(null);
    setNotice(null);
    setBusy(true);

    const message = await onVerify(value);
    if (message) {
      setError(message);
      setCode("");
      setBusy(false);
      input.current?.focus();
    }
    submitting.current = false;
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setResending(true);
    const message = await onResend();
    setResending(false);

    if (message) {
      setError(message);
      return;
    }
    setCode("");
    setCooldown(RESEND_SECONDS);
    setNotice("We sent a new code. Check your inbox.");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
      }}
      className="flex w-full max-w-[400px] flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[32px] font-bold text-slate-900">Verify your email</h2>
        <p className="text-[15px] text-slate-500">
          We sent a {OTP_LENGTH}-digit code to{" "}
          <span className="font-semibold text-slate-900">{email}</span>. It can take a minute to
          arrive. Check your spam folder too.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="otp" className="text-[13px] font-medium text-slate-900">
          Verification code
        </label>
        <input
          ref={input}
          id="otp"
          name="otp"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={code}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby="otp-message"
          placeholder={"0".repeat(OTP_LENGTH)}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
            setCode(value);
            setError(null);
            if (value.length === OTP_LENGTH) submit(value);
          }}
          className={`w-full rounded-[10px] border bg-white px-3.5 py-3 text-center text-2xl font-semibold tracking-[0.5em] text-slate-900 outline-none placeholder:text-slate-300 focus:ring-2 disabled:opacity-60 ${
            error
              ? "border-red-600 focus:ring-red-100"
              : "border-slate-300 focus:border-sky-700 focus:ring-sky-100"
          }`}
        />
        <div id="otp-message" aria-live="polite">
          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : notice ? (
            <p className="text-xs text-green-800">{notice}</p>
          ) : null}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={busy || code.length !== OTP_LENGTH}>
        {busy ? "Verifying…" : "Verify and continue"}
      </Button>

      <div className="flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="cursor-pointer font-medium text-slate-500 hover:text-slate-900 disabled:opacity-60"
        >
          Go back
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={busy || resending || cooldown > 0}
          className="cursor-pointer font-semibold text-sky-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {resending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}
