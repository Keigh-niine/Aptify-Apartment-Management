export type Urgency = "urgent" | "medium" | "low";
export type MStatus = "new" | "assigned" | "resolved";

export type Technician = { id: string; name: string; specialty: string | null };

export type MaintenanceRequest = {
  id: string;
  unit_label: string;
  category: string;
  urgency: Urgency;
  title: string;
  description: string;
  status: MStatus;
  created_at: string;
  resolved_at: string | null;
  visit_at: string | null;
  technician_id: string | null;
  technician_name: string | null;
  requester_id: string;
  requester_name: string | null;
  photos: string[]; // storage paths
  comments: { id: string; body: string; created_at: string; author: string }[];
};

// A request plus ready-to-use image links (the photo bucket is private).
export type RequestView = MaintenanceRequest & { photoUrls: string[] };

export const urgencyRank: Record<Urgency, number> = { urgent: 0, medium: 1, low: 2 };

export const urgencyBadge: Record<Urgency, { text: string; cls: string }> = {
  urgent: { text: "Urgent", cls: "bg-red-100 text-red-800" },
  medium: { text: "Medium", cls: "bg-amber-100 text-amber-800" },
  low: { text: "Low", cls: "bg-slate-100 text-slate-700" },
};

export const categoryLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

export const techLabel = (t: Technician) => (t.specialty ? `${t.name} (${t.specialty})` : t.name);

// ISO time -> value for <input type="datetime-local"> in the viewer's timezone
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
