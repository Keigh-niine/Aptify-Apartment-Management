// Dates are always worked out in Philippine time, so the server (UTC on Vercel),
// the browser and the database all agree on what "today" is.
const TZ = "Asia/Manila";

// Today in Manila, as YYYY-MM-DD
export function manilaToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

// "2026-11-24" + 7 -> "2026-12-01"
export function addDaysISO(iso: string, days: number) {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

// First day of the month after today (Manila), as YYYY-MM-DD
export function firstOfNextMonth() {
  const [y, m] = manilaToday().split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
