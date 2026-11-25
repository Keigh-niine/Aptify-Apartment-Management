"use client";

import { ErrorView } from "@/components/error-view";

export default function LandlordError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorView error={error} reset={reset} homeHref="/landlord" homeLabel="Back to overview" />
  );
}
