"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// A small button that calls a Supabase function, then refreshes the page data.
export function RpcButton({
  label,
  doneLabel,
  rpc,
  args,
  variant = "outline",
  errors,
}: {
  label: string;
  doneLabel?: string;
  rpc: string;
  args: Record<string, string>;
  variant?: "primary" | "outline";
  // Friendly text for known error codes. done = the action was already done, so lock the button.
  errors?: Record<string, { message: string; done?: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [doneText, setDoneText] = useState<string | null>(null);

  async function run() {
    setState("loading");
    const { error } = await createClient().rpc(rpc, args);
    if (error) {
      const known = errors && Object.entries(errors).find(([code]) => error.message.includes(code));
      if (known) {
        toast("info", known[1].message);
        if (known[1].done) {
          setDoneText(known[1].done);
          setState("done");
          return;
        }
      } else {
        toast("err", "Something went wrong. Please try again.");
      }
      setState("error");
      return;
    }
    setState(doneLabel ? "done" : "idle");
    router.refresh();
  }

  return (
    <Button
      size="sm"
      variant={variant}
      onClick={run}
      disabled={state === "loading" || state === "done"}
    >
      {state === "loading"
        ? "…"
        : state === "done"
          ? (doneText ?? doneLabel)
          : state === "error"
            ? "Try again"
            : label}
    </Button>
  );
}