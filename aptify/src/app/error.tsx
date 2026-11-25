"use client";

import { ErrorView } from "@/components/error-view";

// Catches errors outside the landlord and tenant areas, and errors thrown by their layouts.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <ErrorView error={error} reset={reset} homeHref="/" homeLabel="Go to home page" />
    </main>
  );
}
