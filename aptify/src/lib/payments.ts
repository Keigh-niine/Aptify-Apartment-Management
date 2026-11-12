export type PayMethod = "gcash" | "maya";

export const payMethods: { value: PayMethod; label: string }[] = [
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
];

export type PaymentAccountView = {
  method: PayMethod;
  account_name: string;
  account_number: string;
  qr_path: string | null;
  qr_url: string | null; // temporary link (the bucket is private)
};

// "0917 123 4567", "+63 917 123 4567" and "639171234567" all become "09171234567"
export function normalizePhone(input: string) {
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+63")) d = "0" + d.slice(3);
  else if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2);
  return d;
}

export const isValidPhone = (s: string) => /^09\d{9}$/.test(s);

export const formatPhone = (s: string) =>
  s.length === 11 ? `${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7)}` : s;

export const QR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export const QR_MAX_BYTES = 2 * 1024 * 1024;
