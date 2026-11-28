"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { fullDate } from "@/lib/mail-date";
import {
  categoryLabel,
  techLabel,
  toLocalInput,
  urgencyBadge,
  type RequestView,
  type Technician,
} from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/client";
import { ago } from "@/lib/time";

// The overlay for one request. The landlord's only job here is to assign staff.
// Marking a request as resolved is done by the tenant.
export function TicketDetail({
  req,
  technicians,
  userId,
  onSaved,
  onClose,
}: {
  req: RequestView;
  technicians: Technician[];
  userId: string;
  onSaved: (status: "assigned") => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const resolved = req.status === "resolved";
  const alreadyAssigned = req.status === "assigned";

  const [staffId, setStaffId] = useState(req.technician_id ?? "");
  const [visit, setVisit] = useState(req.visit_at ? toLocalInput(req.visit_at) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const badge = urgencyBadge[req.urgency];

  function pickStaff(value: string) {
    setError(null);
    setStaffId(value);
  }

  async function assign() {
    setError(null);
    if (!staffId) {
      setError("Pick who to assign this request to.");
      return;
    }

    setSaving(true);
    const { error: rpcError } = await createClient().rpc("update_maintenance", {
      p_request: req.id,
      p_status: "assigned",
      p_technician: staffId,
      p_visit_at: visit ? new Date(visit).toISOString() : null,
    });
    setSaving(false);

    if (rpcError) {
      toast(
        "err",
        rpcError.message.includes("technician_required")
          ? "Pick who to assign this request to."
          : "Something went wrong. Please try again."
      );
      return;
    }

    toast("ok", alreadyAssigned ? "Assignment updated." : "Request assigned.");
    onSaved("assigned");
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
    <section className="flex flex-col gap-3.5 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id="ticket-title" className="text-xl font-bold text-slate-900">
          {req.title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
            {badge.text}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {req.unit_label} · {categoryLabel(req.category)} · Submitted {ago(req.created_at)} by{" "}
        {req.requester_name ?? "the tenant"}
      </p>
      <p className="whitespace-pre-line text-sm leading-[21px] text-slate-900">{req.description}</p>

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

      {resolved ? (
        // Read-only: the tenant confirmed the repair
        <div className="flex flex-col gap-1 rounded-xl bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            Resolved{req.resolved_at ? ` on ${fullDate(req.resolved_at)}` : ""}
          </p>
          <p>Handled by {req.technician_name ?? "no one recorded"}</p>
          {req.visit_at && <p>Visit: {fullDate(req.visit_at)}</p>}
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-slate-900">Assign to</span>
            <select
              value={staffId}
              onChange={(e) => pickStaff(e.target.value)}
              className={`${inputClass(!!error && !staffId)} cursor-pointer`}
            >
              <option value="">Select staff</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {techLabel(t)}
                </option>
              ))}
            </select>
            {error && <span className="text-xs text-red-600">{error}</span>}
            {technicians.length === 0 && (
              <span className="text-xs text-slate-500">
                No staff yet. Add someone with the Staff button at the top of the page.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-slate-900">Visit date and time (optional)</span>
            <input
              type="datetime-local"
              value={visit}
              onChange={(e) => setVisit(e.target.value)}
              className={inputClass()}
            />
          </label>
        </>
      )}

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

      {/* Stays at the bottom of the overlay while the content scrolls */}
      <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2.5 border-t border-slate-100 bg-white px-6 py-4">
        {!resolved && (
          <Button type="button" onClick={assign} disabled={saving}>
            {saving ? "Assigning…" : "Assign"}
          </Button>
        )}
        {!commenting && (
          <Button type="button" variant="outline" onClick={() => setCommenting(true)}>
            Add comment
          </Button>
        )}
      </div>
    </section>
  );
}