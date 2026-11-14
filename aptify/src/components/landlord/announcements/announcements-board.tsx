"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/landlord/units/confirm-dialog";
import { inputClass, Toggle } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { AnnouncementRow, UnitOption } from "@/lib/announcements";
import { shortLabel } from "@/lib/signup";
import { createClient } from "@/lib/supabase/client";
import { ago } from "@/lib/time";

type Audience = "property" | "units";
type Errors = { title?: string; message?: string; units?: string };

const audiences: { value: Audience; label: string }[] = [
  { value: "property", label: "Whole property" },
  { value: "units", label: "Specific units" },
];

export function AnnouncementsBoard({
  propertyId,
  items,
  units,
}: {
  propertyId: string;
  items: AnnouncementRow[];
  units: UnitOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const composerRef = useRef<HTMLElement>(null);

  // The composer. editingId is set when an existing announcement is being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPublished, setEditingPublished] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>("property");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<null | "post" | "draft">(null);

  // Delete confirmation
  const [deleting, setDeleting] = useState<AnnouncementRow | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditingId(null);
    setEditingPublished(false);
    setTitle("");
    setMessage("");
    setAudience("property");
    setUnitIds([]);
    setNotifyEmail(false);
    setErrors({});
  }

  function startEdit(a: AnnouncementRow) {
    setEditingId(a.id);
    setEditingPublished(a.status === "published");
    setTitle(a.title);
    setMessage(a.body);
    setAudience(a.audience);
    setUnitIds(a.announcement_units.map((u) => u.unit_id));
    setNotifyEmail(a.notify_email);
    setErrors({});
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const toggleUnit = (id: string) =>
    setUnitIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function save(publish: boolean) {
    const t = title.trim();
    const m = message.trim();
    const found: Errors = {};
    if (!t) found.title = "Enter a title.";
    if (!m) found.message = "Write a message for your tenants.";
    if (audience === "units" && unitIds.length === 0) found.units = "Choose at least one unit.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(publish ? "post" : "draft");
    const { error } = await createClient().rpc("save_announcement", {
      p_property: propertyId,
      p_id: editingId,
      p_title: t,
      p_body: m,
      p_audience: audience,
      p_unit_ids: audience === "units" ? unitIds : [],
      p_notify_email: notifyEmail,
      p_publish: publish,
    });
    setSaving(null);

    if (error) {
      toast(
        "err",
        error.message.includes("no_units_selected")
          ? "Choose at least one unit."
          : "Something went wrong. Please try again."
      );
      return;
    }

    toast("ok", editingId ? "Announcement updated." : publish ? "Announcement posted." : "Draft saved.");
    reset();
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const { error } = await createClient().from("announcements").delete().eq("id", deleting.id);
    setBusy(false);
    if (error) {
      toast("err", "Something went wrong. Please try again.");
      return;
    }
    if (editingId === deleting.id) reset();
    setDeleting(null);
    toast("ok", "Announcement deleted.");
    router.refresh();
  }

  const audienceText = (a: AnnouncementRow) =>
    a.audience === "property"
      ? "Whole property"
      : `${a.announcement_units.length} unit${a.announcement_units.length === 1 ? "" : "s"}`;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,554px)_minmax(0,1fr)]">
      {/* ---------- Composer ---------- */}
      <section
        ref={composerRef}
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <h2 className="text-lg font-bold text-slate-900">
          {editingId ? "Edit announcement" : "New announcement"}
        </h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">Title</span>
          <input
            value={title}
            maxLength={120}
            placeholder="e.g. Water interruption on Saturday"
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass(!!errors.title)}
          />
          {errors.title && <span className="text-xs text-red-600">{errors.title}</span>}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">Message</span>
          <textarea
            value={message}
            maxLength={2000}
            rows={5}
            placeholder="Write your message to tenants"
            onChange={(e) => setMessage(e.target.value)}
            className={`${inputClass(!!errors.message)} resize-y`}
          />
          {errors.message && <span className="text-xs text-red-600">{errors.message}</span>}
        </label>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-slate-900">Send to</p>
          <div className="flex flex-wrap gap-2">
            {audiences.map((a) => (
              <button
                key={a.value}
                type="button"
                aria-pressed={audience === a.value}
                onClick={() => setAudience(a.value)}
                className={`cursor-pointer rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold ${
                  audience === a.value
                    ? "border-sky-700 bg-sky-100 text-sky-700"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          {audience === "units" && (
            <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Choose the units that should see this.</p>
                <button
                  type="button"
                  onClick={() =>
                    setUnitIds(unitIds.length === units.length ? [] : units.map((u) => u.id))
                  }
                  className="cursor-pointer text-xs font-semibold text-sky-700 hover:underline"
                >
                  {unitIds.length === units.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {units.map((u) => {
                  const on = unitIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleUnit(u.id)}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] font-medium ${
                        on
                          ? "border-sky-700 bg-sky-100 text-sky-700"
                          : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100"
                      }`}
                    >
                      {shortLabel(u.label)}
                    </button>
                  );
                })}
              </div>
              {errors.units && <p className="text-xs text-red-600">{errors.units}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Toggle checked={notifyEmail} onChange={setNotifyEmail} label="Also notify tenants by email" />
          <span className="text-sm text-slate-900">Also notify tenants by email</span>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {editingId && editingPublished ? (
            <Button type="button" onClick={() => save(true)} disabled={saving !== null}>
              {saving === "post" ? "Saving…" : "Save changes"}
            </Button>
          ) : (
            <>
              <Button type="button" onClick={() => save(true)} disabled={saving !== null}>
                {saving === "post" ? "Posting…" : "Post announcement"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => save(false)}
                disabled={saving !== null}
              >
                {saving === "draft" ? "Saving…" : "Save draft"}
              </Button>
            </>
          )}
          {editingId && (
            <Button type="button" variant="outline" onClick={reset} disabled={saving !== null}>
              Cancel
            </Button>
          )}
        </div>
      </section>

      {/* ---------- Past announcements ---------- */}
      <section className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="mb-2 text-lg font-bold text-slate-900">Past announcements</h2>

        {items.length === 0 && <p className="py-3 text-sm text-slate-500">No announcements yet.</p>}

        {items.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-4 border-t border-slate-100 py-3 first:border-t-0"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate text-sm font-semibold text-slate-900">{a.title}</p>
              <p className="text-xs text-slate-500">
                {audienceText(a)} ·{" "}
                {a.status === "published" ? ago(a.published_at ?? a.created_at) : "Not posted"}
                {a.status === "draft" && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    Draft
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => startEdit(a)}>
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeleting(a)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </section>

      {deleting && (
        <ConfirmDialog
          title="Delete this announcement?"
          body={`“${deleting.title}” will be removed for all tenants. This cannot be undone.`}
          confirmLabel="Delete announcement"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
