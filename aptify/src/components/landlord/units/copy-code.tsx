"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

// Shows an invite code. Clicking it copies the code.
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available: the code is still on screen to select by hand
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : "Click to copy the code"}
      aria-label={`Invite code ${code}. Click to copy.`}
      className="inline-flex w-fit cursor-pointer select-all items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold tracking-wide text-slate-900 hover:bg-slate-200"
    >
      {code}
      {copied ? (
        <Check className="size-3.5 text-green-700" aria-hidden />
      ) : (
        <Copy className="size-3.5 text-slate-500" aria-hidden />
      )}
    </button>
  );
}