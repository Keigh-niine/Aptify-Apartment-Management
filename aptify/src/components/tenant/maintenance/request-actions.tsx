"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { inputClass } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function CommentForm({ requestId, userId }: { requestId: string; userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;

    setBusy(true);
    const { error } = await createClient()
      .from("maintenance_comments")
      .insert({ request_id: requestId, author_id: userId, body });
    setBusy(false);

    if (error) {
      toast("err", "Couldn't send your comment. Please try again.");
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-900">Add a comment</span>
        <textarea
          rows={3}
          value={text}
          maxLength={1000}
          placeholder="Write a message to your landlord"
          onChange={(e) => setText(e.target.value)}
          className={`${inputClass()} resize-none`}
        />
      </label>
      <div>
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

export function ReopenButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function reopen() {
    setBusy(true);
    const { error } = await createClient().rpc("tenant_reopen_request", { p_request: requestId });
    setBusy(false);

    if (error) {
      toast("err", "Couldn't reopen the request. Please try again.");
      return;
    }
    toast("ok", "Request reopened. Your landlord was notified.");
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={reopen} disabled={busy}>
      {busy ? "Reopening…" : "Reopen request"}
    </Button>
  );
}

// "Mark as resolved": asks first, then tells the landlord the repair is done
export function ResolveButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function resolve() {
    setBusy(true);
    const { error } = await createClient().rpc("tenant_resolve_request", { p_request: requestId });
    setBusy(false);

    if (error) {
      toast(
        "err",
        error.message.includes("already_resolved")
          ? "This request is already resolved."
          : "Couldn't mark the request as resolved. Please try again."
      );
      setOpen(false);
      router.refresh();
      return;
    }
    setOpen(false);
    toast("ok", "Marked as resolved. Your landlord was notified.");
    router.refresh();
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Mark as resolved
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-title"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[440px] flex-col gap-3 rounded-2xl bg-white p-7 shadow-xl"
          >
            <h2 id="resolve-title" className="text-xl font-bold text-slate-900">
              Is this repair done?
            </h2>
            <p className="text-sm leading-[22px] text-slate-500">
              Only mark it as resolved if the problem is fixed. Your landlord will be told, and the
              request moves to Resolved. If it comes back, you can reopen it.
            </p>
            <div className="mt-2 flex justify-end gap-2.5">
              <Button type="button" variant="outline" autoFocus onClick={() => setOpen(false)} disabled={busy}>
                Not yet
              </Button>
              <Button type="button" onClick={resolve} disabled={busy}>
                {busy ? "Please wait…" : "Yes, it's resolved"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}