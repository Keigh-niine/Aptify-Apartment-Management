"use client";

import { ErrorView } from "@/components/error-view";

export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView error={error} reset={reset} homeHref="/tenant" homeLabel="Back to My Home" />;
}
