"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { inputClass } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  categories,
  MAX_PHOTOS,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  urgencies,
  type Category,
  type Urgency,
} from "@/lib/tenant-maintenance";
import { createClient } from "@/lib/supabase/client";

type Photo = { id: number; file: File; url: string };
type Errors = { title?: string; description?: string; photos?: string };

const steps = [
  { done: true, title: "Your landlord receives your request", sub: "You get a confirmation" },
  { done: false, title: "Staff is assigned", sub: "You see who is coming and when" },
  { done: false, title: "You mark it as resolved", sub: "Once the repair is done. You can reopen it later" },
];

const chip = (on: boolean) =>
  `cursor-pointer rounded-lg border px-3.5 py-[7px] text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
    on
      ? "border-sky-700 bg-sky-100 text-sky-700"
      : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
  }`;

export function RequestForm({ unitId, userId }: { unitId: string; userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("plumbing");
  const [urgency, setUrgency] = useState<Urgency>("medium");
  const [description, setDescription] = useState("");
  const [preferred, setPreferred] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    let problem: string | undefined;
    const added: Photo[] = [];

    for (const file of Array.from(list)) {
      if (photos.length + added.length >= MAX_PHOTOS) {
        problem = `You can add up to ${MAX_PHOTOS} photos.`;
        break;
      }
      if (!PHOTO_TYPES[file.type]) {
        problem = "Use PNG, JPG or WebP images.";
        continue;
      }
      if (file.size > PHOTO_MAX_BYTES) {
        problem = "Each photo must be 5 MB or smaller.";
        continue;
      }
      added.push({ id: ++nextId.current, file, url: URL.createObjectURL(file) });
    }
    setErrors((e) => ({ ...e, photos: problem }));
    if (added.length) setPhotos((p) => [...p, ...added]);
  }

  function removePhoto(id: number) {
    setPhotos((list) => {
      const gone = list.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return list.filter((p) => p.id !== id);
    });
  }

  async function generateDescription() {
    const requestTitle = title.trim();
    if (!requestTitle) return;

    setGenerating(true);
    try {
      const response = await fetch("/api/tenant/maintenance/description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: requestTitle, category, urgency }),
      });
      const result: { description?: unknown; error?: unknown } = await response.json();

      if (!response.ok) {
        toast(
          "err",
          typeof result.error === "string"
            ? result.error
            : "Couldn't write a description. Please try again."
        );
        return;
      }

      if (typeof result.description !== "string" || !result.description.trim()) {
        toast("err", "The AI returned an empty description. Please try again.");
        return;
      }

      setDescription(result.description.trim());
      setErrors((current) => ({ ...current, description: undefined }));
    } catch {
      toast("err", "Couldn't reach the AI service. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const found: Errors = {};
    if (!title.trim()) found.title = "Give the problem a short title.";
    if (!description.trim()) found.description = "Describe what needs fixing.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const supabase = createClient();

    // 1) The request itself
    const { data: created, error } = await supabase
      .from("maintenance_requests")
      .insert({
        unit_id: unitId,
        requested_by: userId,
        category,
        urgency,
        title: title.trim(),
        description: description.trim(),
        preferred_time: preferred.trim() || null,
      })
      .select("id")
      .single();

    if (error || !created) {
      toast("err", "Couldn't send your request. Please try again.");
      setBusy(false);
      return;
    }

    // 2) Photos go to the private bucket, then get linked to the request
    let failed = 0;
    for (const p of photos) {
      const path = `${created.id}/${Date.now()}-${p.id}.${PHOTO_TYPES[p.file.type]}`;
      const up = await supabase.storage
        .from("maintenance-photos")
        .upload(path, p.file, { contentType: p.file.type, upsert: false });
      if (up.error) {
        failed++;
        continue;
      }
      const link = await supabase
        .from("maintenance_photos")
        .insert({ request_id: created.id, storage_path: path });
      if (link.error) failed++;
    }

    toast(
      failed > 0 ? "info" : "ok",
      failed > 0
        ? "Request sent, but some photos could not be uploaded."
        : "Request sent to your landlord."
    );
    router.push(`/tenant/maintenance/${created.id}`);
    router.refresh();
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">Short title</span>
          <input
            value={title}
            maxLength={120}
            placeholder="e.g. Leaking kitchen faucet"
            disabled={generating}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass(!!errors.title)}
          />
          {errors.title && <span className="text-xs text-red-600">{errors.title}</span>}
        </label>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-slate-900">Category</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={category === c.value}
                disabled={generating}
                onClick={() => setCategory(c.value)}
                className={chip(category === c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-slate-900">Urgency</p>
          <div className="flex flex-wrap gap-2">
            {urgencies.map((u) => (
              <button
                key={u.value}
                type="button"
                aria-pressed={urgency === u.value}
                disabled={generating}
                onClick={() => setUrgency(u.value)}
                className={chip(urgency === u.value)}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">Describe the issue</span>
          <textarea
            rows={5}
            value={description}
            maxLength={2000}
            placeholder="e.g. Water is dripping under the kitchen sink whenever the faucet is running."
            disabled={generating}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass(!!errors.description)} resize-y`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!title.trim() || generating || busy}
            onClick={generateDescription}
            className="self-start"
          >
            {generating ? "Writing description…" : "Write description with AI"}
          </Button>
          {!title.trim() && (
            <span className="text-xs text-slate-500">Add a title to enable AI writing.</span>
          )}
          {errors.description && <span className="text-xs text-red-600">{errors.description}</span>}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-slate-900">Photos</p>
          <div className="flex flex-wrap gap-3">
            {photos.map((p, i) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={`Photo ${i + 1}`}
                  className="h-[90px] w-[120px] rounded-lg border border-slate-200 bg-slate-100 object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => removePhoto(p.id)}
                  className="absolute -right-2 -top-2 flex size-6 cursor-pointer items-center justify-center rounded-full bg-slate-900 text-xs text-white"
                >
                  ✕
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex h-[90px] w-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-slate-300 bg-slate-50 text-sky-700 transition-colors hover:bg-slate-100"
              >
                <span className="text-xl font-medium leading-none">+</span>
                <span className="text-[13px] font-semibold">Add photo</span>
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Add photos"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-slate-500">
            Up to {MAX_PHOTOS} photos. PNG, JPG or WebP, 5 MB each.
          </p>
          {errors.photos && <p className="text-xs text-red-600">{errors.photos}</p>}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-slate-900">Preferred time (optional)</span>
          <input
            value={preferred}
            maxLength={120}
            placeholder="e.g. Weekdays after 5:00 PM"
            onChange={(e) => setPreferred(e.target.value)}
            className={inputClass()}
          />
        </label>

        <div className="flex gap-2.5">
          <Button type="submit" disabled={busy || generating}>
            {busy ? "Sending…" : "Submit request"}
          </Button>
          <Link
            href="/tenant/maintenance"
            className="inline-flex items-center justify-center rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
      </form>

      <section className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">What happens next</h2>
        {steps.map((s) => (
          <div key={s.title} className="flex items-start gap-3">
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                s.done ? "bg-sky-700 text-white" : "border border-slate-300 bg-white"
              }`}
            >
              {s.done ? "✓" : ""}
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-slate-900">{s.title}</p>
              <p className="text-xs text-slate-500">{s.sub}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}