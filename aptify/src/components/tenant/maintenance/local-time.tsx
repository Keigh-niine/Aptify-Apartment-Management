"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function LocalTime({
  iso,
  options = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
}: {
  iso: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  // Reserve the space until the browser knows its timezone
  if (!mounted) return <span className="invisible">Nov 00, 0:00 AM</span>;
  return <>{new Date(iso).toLocaleString("en-US", options)}</>;
}
