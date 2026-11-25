"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";

// Shared by the error boundaries (error.tsx) in app/, app/landlord and app/tenant.
export function ErrorView({
  error,
  reset,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  function retry() {
    // reset() alone re-renders with the same server data, so refresh first.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex flex-col gap-3 py-10">
      <div className="flex max-w-[480px] flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-500">
            We couldn&apos;t load this page. Please try again. If it keeps happening, come back in a
            few minutes.
          </p>
          {error.digest && <p className="text-xs text-slate-400">Reference: {error.digest}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={retry}>Try again</Button>
          <Button variant="outline" onClick={() => router.push(homeHref)}>
            {homeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
