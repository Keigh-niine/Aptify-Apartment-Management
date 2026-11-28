"use client";

import { Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/landlord/units/ui";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { Technician } from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/client";
import { TicketDialog } from "./ticket-dialog";

// "Staff" button at the top of Maintenance. Opens the list of people requests can be assigned to.
export function StaffButton({
  staff,
  openCounts,
  propertyId,
}: {
  staff: Technician[];
  openCounts: Record<string, number>; // staff id -> requests assigned to them that are not resolved yet
  propertyId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-2">
          <Users className="size-4" aria-hidden />
          Staff ({staff.length})
        </span>
      </Button>
      {open && (
        <TicketDialog labelledBy="staff-title" onClose={() => setOpen(false)}>
          <StaffList
            staff={staff}
            openCounts={openCounts}
            propertyId={propertyId}
            onClose={() => setOpen(false)}
          />
        </TicketDialog>
      )}
    </>
  );
}

function StaffList({
  staff,
  openCounts,
  propertyId,
  onClose,
}: {
  staff: Technician[];
  openCounts: Record<string, number>;
  propertyId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setAdding(true);
    const { error } = await createClient()
      .from("technicians")
      .insert({ property_id: propertyId, name: trimmed, specialty: role.trim() || null });
    setAdding(false);

    if (error) {
      toast("err", "Couldn't add this person. Please try again.");
      return;
    }
    setName("");
    setRole("");
    toast("ok", `${trimmed} added to your staff.`);
    router.refresh();
  }

  // Removing hides the person from the list and the "Assign to" choices. Past requests keep their name.
  async function remove(t: Technician) {
    setRemovingId(t.id);
    const { error } = await createClient()
      .from("technicians")
      .update({ active: false })
      .eq("id", t.id)
      .eq("property_id", propertyId);
    setRemovingId(null);
    setConfirmId(null);

    if (error) {
      toast("err", "Couldn't remove this person. Please try again.");
      return;
    }
    toast("ok", `${t.name} removed.`);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="staff-title" className="text-xl font-bold text-slate-900">
            Staff
          </h2>
          <p className="text-sm text-slate-500">People you can assign repair requests to.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {staff.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          No staff yet. Add the first person below.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
          {staff.map((t) => {
            const openCount = openCounts[t.id] ?? 0;
            const confirming = confirmId === t.id;
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-slate-900">{t.name}</span>
                    <span className="truncate text-xs text-slate-500">
                      {t.specialty || "No role"} · {openCount} open request{openCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {!confirming && (
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirmId(t.id)}>
                      Remove
                    </Button>
                  )}
                </div>

                {confirming && (
                  <div className="flex flex-col gap-2 rounded-lg bg-red-50 p-3">
                    <p className="text-[13px] text-red-800">
                      Remove {t.name}?{" "}
                      {openCount > 0
                        ? `They stay assigned to their ${openCount} open request${openCount === 1 ? "" : "s"}, but you can't pick them for new ones.`
                        : "You can't pick them for new requests."}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => remove(t)}
                        disabled={removingId === t.id}
                        className="inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-red-600 px-3.5 py-[7px] text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {removingId === t.id ? "Removing…" : "Yes, remove"}
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmId(null)}
                        disabled={removingId === t.id}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add staff */}
      <form onSubmit={add} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-4">
        <p className="text-[13px] font-medium text-slate-900">Add staff</p>
        <input
          aria-label="Staff name"
          placeholder="Name, e.g. Mang Rudy"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={inputClass()}
        />
        <input
          aria-label="Staff role"
          placeholder="Role (optional), e.g. plumber"
          value={role}
          maxLength={80}
          onChange={(e) => setRole(e.target.value)}
          className={inputClass()}
        />
        <div>
          <Button type="submit" size="sm" disabled={adding || !name.trim()}>
            {adding ? "Adding…" : "Add staff"}
          </Button>
        </div>
      </form>
    </section>
  );
}