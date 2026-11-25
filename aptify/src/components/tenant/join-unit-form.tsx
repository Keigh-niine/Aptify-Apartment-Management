"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inviteErrorMessage } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";

// For tenants who finished signing up without joining a unit.
export function JoinUnitForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter the invite code from your landlord.");
      return;
    }

    setError(null);
    setBusy(true);
    const { data, error: rpcError } = await createClient().rpc("redeem_invite", {
      p_code: trimmed,
    });

    if (rpcError) {
      setError(inviteErrorMessage(rpcError.message));
      setBusy(false);
      return;
    }
    // A bad code comes back as null (not an error), so failed guesses can be counted.
    if (!data) {
      setError(inviteErrorMessage("invalid_invite_code"));
      setBusy(false);
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <label htmlFor="invite-code" className="text-[13px] font-medium text-slate-900">
        Invite code
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={!!error}
          placeholder="Enter your code"
          className={`min-w-0 flex-1 rounded-[10px] border bg-white px-3.5 py-3 text-sm uppercase text-slate-900 outline-none placeholder:normal-case placeholder:text-slate-400 focus:ring-2 sm:max-w-[260px] ${
            error
              ? "border-red-600 focus:ring-red-100"
              : "border-slate-300 focus:border-sky-700 focus:ring-sky-100"
          }`}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Joining..." : "Join unit"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
