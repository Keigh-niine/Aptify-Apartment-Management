export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  audience: "property" | "units";
  notify_email: boolean;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  announcement_units: { unit_id: string }[];
};

export type UnitOption = { id: string; label: string };
