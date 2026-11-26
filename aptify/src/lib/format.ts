export function formatPeso(n: number) {
  return (
    "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

// For big stat cards: ₱45,000 stays as it is, ₱2,469,827,160 becomes ₱2.47B
export function formatPesoCompact(n: number) {
  if (Math.abs(n) < 1_000_000) return formatPeso(n).replace(/\.00$/, "");
  return "₱" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// iso is "YYYY-MM-DD"
export function formatDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}