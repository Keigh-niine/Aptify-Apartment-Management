"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  techLabel,
  toLocalInput,
  urgencyBadge,
  type MStatus,
  type RequestView,
  type Technician,
} from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/client";
import { ago } from "@/lib/time";

const statuses: { value: MStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "assigned", label: "Assigned" },
  { value: "resolved", label: "Resolved" },
];

const ADD_NEW = "__add__";

export function TicketDetail({
  req,
  technicians,
  userId,
  propertyId,
  onSaved,
}: {
  req: RequestView;
  technicians: Technician[];
  userId: string;
  propertyId: string;
  onSaved: (status: MStatus) => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = useState<MStatus>(req.status);
  const [techId, setTechId] = useState(req.technician_id ?? "");
  const [visit, setVisit] = useState(req.visit_at ? toLocalInput(req.visit_at) : "");
  const [techs, setTechs] = useState(technicians);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [addingTech, setAddingTech] = useState(false);
  const [techName, setTechName] = useState("");
  const [techRole, setTechRole] = useState("");

  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const badge = urgencyBadge[req.urgency];
  const isNew = status === "new";

  function pickTech(value: string) {
    if (value === ADD_NEW) {
      setAddingTech(true);
      return;
    }
    setTechId(value);
    if (value && status === "new") setStatus("assigned");
  }

  async function addTech() {
    const name = techName.trim();
    if (!name) return;
    const { data, error: insertError } = await createClient()
      .from("technicians")
      .insert({ property_id: propertyId, name, specialty: techRole.trim() || null })
      .select("id, name, specialty")
      .single();

    if (insertError || !data) {
      toast("err", "Couldn't add the technician. Please try again.");
      return;
    }
    setTechs((list) => [...list, data as Technician].sort((a, b) => a.name.localeCompare(b.name)));
    setTechId(data.id);
    if (status === "new") setStatus("assigned");
    setAddingTech(false);
    setTechName("");
    setTechRole("");
    router.refresh();
  }

  async function save() {
    setError(null);
    if (status === "assigned" && !techId) {
      setError("Pick who this request is assigned to.");
      return;
    }

    setSaving(true);
    const { error: rpcError } = await createClient().rpc("update_maintenance", {
      p_request: req.id,
      p_status: status,
      p_technician: status === "new" ? null : techId || null,
      p_visit_at: status === "new" || !visit ? null : new Date(visit).toISOString(),
    });
    setSaving(false);

    if (rpcError) {
      toast(
        "err",
        rpcError.message.includes("technician_required")
          ? "Pick who this request is assigned to."
          : "Something went wrong. Please try again."
      );
      return;
    }

    toast("ok", "Request updated.");
    onSaved(status);
    router.refresh();
  }

  async function sendComment() {
    const body = comment.trim();
    if (!body) return;

    setSending(true);
    const { error: insertError } = await createClient()
      .from("maintenance_comments")
      .insert({ request_id: req.id, author_id: userId, body });
    setSending(false);

    if (insertError) {
      toast("err", "Couldn't send the comment. Please try again.");
      return;
    }
    setComment("");
    setCommenting(false);
    toast("ok", "Comment added.");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{req.title}</h2>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
          {badge.text}
        </span>
      </div>

      <p className="text-xs text-slate-500">
        {req.unit_label} · Submitted {ago(req.created_at)} by {req.requester_name ?? "the tenant"}
      </p>
      <p className="text-sm leading-[21px] text-slate-900">{req.description}</p>

      {req.photoUrls.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {req.photoUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Photo ${i + 1} of the problem`}
                className="h-[90px] w-[120px] rounded-lg bg-slate-100 object-cover"
              />
            </a>
          ))}
        </div>
      )}

      {/* Status */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-slate-900">Status</p>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={status === s.value}
              onClick={() => setStatus(s.value)}
              className={`cursor-pointer rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold ${
                status === s.value
                  ? "border-sky-700 bg-sky-100 text-sky-700"
                  : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Assign */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-900">Assign to</span>
        <select
          value={techId}
          disabled={isNew}
          onChange={(e) => pickTech(e.target.value)}
          className={inputClass(!!error && !techId)}
        >
          <option value="">{isNew ? "Choose Assigned to pick someone" : "Select a technician"}</option>
          {techs.map((t) => (
            <option key={t.id} value={t.id}>
              {techLabel(t)}
            </option>
          ))}
          <option value={ADD_NEW}>+ Add a technician…</option>
        </select>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </label>

      {addingTech && (
        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
          <input
            autoFocus
            aria-label="Technician name"
            placeholder="Name, e.g. Mang Rudy"
            value={techName}
            onChange={(e) => setTechName(e.target.value)}
            className={inputClass()}
          />
          <input
            aria-label="Technician role"
            placeholder="Role (optional), e.g. maintenance"
            value={techRole}
            onChange={(e) => setTechRole(e.target.value)}
            className={inputClass()}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={addTech} disabled={!techName.trim()}>
              Add technician
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAddingTech(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-slate-900">Visit date and time (optional)</span>
        <input
          type="datetime-local"
          value={visit}
          disabled={isNew}
          onChange={(e) => setVisit(e.target.value)}
          className={inputClass()}
        />
      </label>

      {/* Comments */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-slate-900">Comments</p>
        {req.comments.length === 0 && <p className="text-xs text-slate-500">No comments yet.</p>}
        {req.comments.map((c) => (
          <div key={c.id} className="flex flex-col gap-0.5 rounded-[10px] bg-slate-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-slate-900">{c.author}</p>
            <p className="text-[13px] text-slate-500">{c.body}</p>
          </div>
        ))}
      </div>

      {commenting && (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            rows={3}
            aria-label="Write a comment"
            placeholder="Write a message to the tenant"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={`${inputClass()} resize-none`}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={sendComment} disabled={sending || !comment.trim()}>
              {sending ? "Sending…" : "Send"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setCommenting(false);
                setComment("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2.5">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Update status"}
        </Button>
        {!commenting && (
          <Button type="button" variant="outline" onClick={() => setCommenting(true)}>
            Add comment
          </Button>
        )}
      </div>
    </section>
  );
}
