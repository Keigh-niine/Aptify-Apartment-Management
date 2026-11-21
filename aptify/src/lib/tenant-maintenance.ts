export type Category = "plumbing" | "electrical" | "appliance" | "carpentry" | "other";
export type Urgency = "low" | "medium" | "urgent";
export type Status = "new" | "assigned" | "resolved";

export const categories: { value: Category; label: string }[] = [
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "appliance", label: "Appliance" },
  { value: "carpentry", label: "Carpentry" },
  { value: "other", label: "Other" },
];

export const urgencies: { value: Urgency; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "urgent", label: "Urgent" },
];

export const statusChip: Record<Status, { text: string; cls: string }> = {
  new: { text: "New", cls: "bg-amber-100 text-amber-800" },
  assigned: { text: "Assigned", cls: "bg-blue-100 text-blue-800" },
  resolved: { text: "Resolved", cls: "bg-green-100 text-green-800" },
};

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Repair photos: private bucket "maintenance-photos", path {request_id}/{file}
export const PHOTO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 5;

export type RequestRow = {
  id: string;
  title: string;
  category: Category;
  urgency: Urgency;
  status: Status;
  created_at: string;
};
