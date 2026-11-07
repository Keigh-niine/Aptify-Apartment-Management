import { z } from "zod";

export type Role = "tenant" | "landlord";

export const accountSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name."),
    lastName: z.string().trim().min(1, "Enter your last name."),
    email: z.string().trim().email("Enter a valid email address."),
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
