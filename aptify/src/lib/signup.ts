import { z } from "zod";
import { isValidPhone, normalizePhone } from "@/lib/payments";

export type Role = "tenant" | "landlord";

export const accountSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name."),
    lastName: z.string().trim().min(1, "Enter your last name."),
    email: z.string().trim().email("Enter a valid email address."),
    phone: z
      .string()
      .trim()
      .refine((v) => isValidPhone(normalizePhone(v)), "Enter a valid mobile number, like 0917 123 4567."),
    password: z.string().min(8, "At least 8 characters."),
    confirmPassword: z.string(),
    role: z.enum(["tenant", "landlord"]),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type AccountValues = z.infer<typeof accountSchema>;

export type PropertyType = "apartment_building" | "boarding_house" | "townhouse" | "other";

export const propertyTypes: { value: PropertyType; label: string }[] = [
  { value: "apartment_building", label: "Apartment building" },
  { value: "boarding_house", label: "Boarding house" },
  { value: "townhouse", label: "Townhouse" },
  { value: "other", label: "Other" },
];

export type PropertyData = {
  name: string;
  street: string;
  city: string;
  province: string;
  type: PropertyType;
  unitCount: number;
};

export type UnitItem = { id: number; label: string };

let counter = 0;
export const nextUnitId = () => ++counter;

// generateUnits(3, 4) -> Unit 1A ... Unit 3D
export function generateUnits(floors: number, perFloor: number, limit?: number): UnitItem[] {
  const out: UnitItem[] = [];
  for (let f = 1; f <= floors; f++) {
    for (let n = 0; n < perFloor; n++) {
      out.push({ id: nextUnitId(), label: `Unit ${f}${String.fromCharCode(65 + n)}` });
    }
  }
  return limit ? out.slice(0, limit) : out;
}

export const shortLabel = (label: string) => label.replace(/^unit\s+/i, "");

export type InvitePreview = {
  ok: true;
  unit_label: string;
  property_name: string;
  street_address: string;
  city: string;
  monthly_rent: number;
  due_day: number;
  start_date: string;
  security_deposit: number;
  advance_rent: number;
  charges: { name: string; mode: "fixed" | "variable"; fixed_amount: number | null }[];
};

export function inviteErrorMessage(raw: string) {
  if (raw.includes("too_many_attempts")) {
    return "Too many incorrect codes. Wait about 15 minutes, then try again.";
  }
  if (raw.includes("invalid_invite_code")) {
    return "We couldn't find that code. Check it and try again.";
  }
  if (raw.includes("invite_email_mismatch")) {
    return "This invite was sent to a different email address. Use the email your landlord invited, or ask for a new code.";
  }
  if (/invite_(expired|already_used|revoked)/.test(raw)) {
    return "This code has expired or was already used. Ask your landlord for a new one.";
  }
  return "Something went wrong. Please try again.";
}

// Length of the email code. Must match "Email OTP Length" in the Supabase dashboard
// (Authentication -> Providers -> Email). The default there is 6.
export const OTP_LENGTH = 6;

// How long an unverified sign up is kept. The database job in
// cleanup-unverified-signups.sql deletes accounts this long after their last code was sent,
// so keep the two numbers the same. Email can be slow, so do not set this below ~5 minutes.
export const UNVERIFIED_SIGNUP_TTL_MINUTES = 10;

export function otpErrorMessage(error: { code?: string; message?: string }) {
  const code = error.code ?? "";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "Too many attempts. Wait a minute, then try again.";
  }
  // Supabase uses the same error for a wrong code and an expired one.
  return "That code is incorrect or has expired. Check it, or request a new code.";
}

export function signUpErrorMessage(error: { code?: string; message?: string }) {
  if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "Too many emails were sent. Wait a minute, then try again.";
  }
  if (error.code === "weak_password") {
    return "That password is too weak. Use at least 8 characters.";
  }
  return "We couldn't create your account. Please try again.";
}