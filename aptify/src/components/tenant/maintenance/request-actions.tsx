"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
