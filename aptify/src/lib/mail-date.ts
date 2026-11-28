const TZ = "Asia/Manila";

// Like Gmail: the time for today, "Nov 27" for this year, "11/27/25" for older items
export function mailDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  if (day(d) === day(now)) {
    return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  }
  const sameYear =
    d.toLocaleDateString("en-US", { timeZone: TZ, year: "numeric" }) ===
    now.toLocaleDateString("en-US", { timeZone: TZ, year: "numeric" });
  return sameYear
    ? d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })
    : d.toLocaleDateString("en-US", { timeZone: TZ, month: "numeric", day: "numeric", year: "2-digit" });
}

export function fullDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}