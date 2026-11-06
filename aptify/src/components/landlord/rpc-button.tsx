"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

// A small button that calls a Supabase function, then refreshes the page data.
export function RpcButton({
  label,
  doneLabel,
  rpc,
  args,
  variant = "outline",
}: {
  label: string;
  doneLabel?: string;
  rpc: string;
  args: Record<string, string>;
  variant?: "primary" | "outline";
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function run() {
    setState("loading");
    const { error } = await createClient().rpc(rpc, args);
    if (error) {
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
          ? doneLabel
          : state === "error"
            ? "Try again"
            : label}
    </Button>
  );
}
