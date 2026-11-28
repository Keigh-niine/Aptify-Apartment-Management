import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/tenant/maintenance/local-time";
import { CommentForm, ReopenButton, ResolveButton } from "@/components/tenant/maintenance/request-actions";
import { getTenantContext } from "@/lib/tenant";
import { cap, statusChip, type Status } from "@/lib/tenant-maintenance";

export const instant = false;

type Event = { id: string; status: Status; note: string | null; created_at: string };

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getTenantContext();

  const { data: req } = await supabase
    .from("maintenance_requests")
    .select(
      "id, title, category, urgency, status, description, preferred_time, created_at, visit_at, requested_by"
    )
    .eq("id", id)
    .maybeSingle();

  // Only the tenant who sent the request can open it
  if (!req || req.requested_by !== user.id) notFound();

  const [eventsRes, photosRes, commentsRes] = await Promise.all([
    supabase
      .from("maintenance_events")
      .select("id, status, note, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("maintenance_photos")
      .select("storage_path, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("maintenance_comments")
      .select("id, author_id, body, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
  ]);

  // The photo bucket is private, so each photo needs a temporary link.
  const paths = (photosRes.data ?? []).map((p) => p.storage_path as string);
  const photoUrls: string[] = [];
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("maintenance-photos")
      .createSignedUrls(paths, 3600);
    signed?.forEach((s) => {
      if (s.signedUrl) photoUrls.push(s.signedUrl);
    });
  }

  const status = req.status as Status;
  const chip = statusChip[status];

  // ---------- Progress: what happened, then what is still to come ----------
  const events = (eventsRes.data ?? []) as Event[];
  const done = events.length
    ? events
    : [{ id: "received", status: "new" as Status, note: "Request received", created_at: req.created_at }];
  const lastAssigned = [...done].reverse().find((e) => e.status === "assigned");

  const upcoming: { title: string; sub: string }[] = [];
  if (status === "new") {
    upcoming.push({ title: "Staff is assigned", sub: "You see who is coming and when" });
  }
  if (status !== "resolved") {
    upcoming.push({ title: "Resolved", sub: "Tap Mark as resolved once the repair is done" });
  }

  const comments = commentsRes.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/tenant/maintenance"
          className="w-fit text-[13px] font-semibold text-sky-700 hover:underline"
        >
          ← All requests
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-[30px] font-bold text-slate-900">{req.title}</h1>
            <p className="text-[15px] text-slate-500">
              {cap(req.category)} · {cap(req.urgency)} · Submitted{" "}
              <LocalTime
                iso={req.created_at}
                options={{ month: "long", day: "numeric" }}
              />
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip.cls}`}>
              {chip.text}
            </span>
            {status !== "resolved" && <ResolveButton requestId={req.id} />}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          {/* Details */}
          <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-bold text-slate-900">Description</h2>
            <p className="whitespace-pre-line text-sm leading-[22px] text-slate-700">
              {req.description}
            </p>
            {req.preferred_time && (
              <p className="text-xs text-slate-500">Preferred time: {req.preferred_time}</p>
            )}
            {photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {photoUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Photo ${i + 1} of the problem`}
                      className="h-[90px] w-[120px] rounded-lg border border-slate-200 bg-slate-100 object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </section>

          {/* Progress */}
          <section className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-bold text-slate-900">Progress</h2>

            {done.map((e) => (
              <div key={e.id} className="flex items-start gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-700 text-[11px] font-bold text-white">
                  ✓
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-slate-900">
                    {e.note ?? (e.status === "resolved" ? "Resolved" : "Update")}
                  </p>
                  <p className="text-xs text-slate-500">
                    <LocalTime iso={e.created_at} />
                    {lastAssigned?.id === e.id && req.visit_at && status !== "new" && (
                      <>
                        {" · Visit set for "}
                        <LocalTime iso={req.visit_at} />
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}

            {upcoming.map((u) => (
              <div key={u.title} className="flex items-start gap-3">
                <span className="size-5 shrink-0 rounded-full border border-slate-300 bg-white" />
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium text-slate-500">{u.title}</p>
                  <p className="text-xs text-slate-500">{u.sub}</p>
                </div>
              </div>
            ))}

            {status === "resolved" && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <p className="text-xs text-slate-500">Not fixed? You can comment or reopen it.</p>
                <ReopenButton requestId={req.id} />
              </div>
            )}
          </section>
        </div>

        {/* Comments */}
        <section className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Comments</h2>

          {comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
          {comments.map((c) => (
            <div key={c.id} className="flex flex-col gap-0.5 rounded-[10px] bg-slate-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-slate-900">
                {c.author_id === user.id ? "You" : "Landlord"}
                <span className="ml-2 font-normal text-slate-500">
                  <LocalTime iso={c.created_at} />
                </span>
              </p>
              <p className="whitespace-pre-line text-[13px] text-slate-600">{c.body}</p>
            </div>
          ))}

          <CommentForm requestId={req.id} userId={user.id} />
        </section>
      </div>
    </div>
  );
}