import type { SupabaseClient } from "@supabase/supabase-js";

export type FilePaths = {
  payment_qr?: string[];
  maintenance_photos?: string[];
} | null;

// Deletes the listed files from Storage. Best effort: if a file is already gone
// or can't be removed, the account deletion still goes ahead.
export async function removeStorageFiles(supabase: SupabaseClient, files: FilePaths) {
  const jobs: PromiseLike<unknown>[] = [];
  if (files?.payment_qr?.length) {
    jobs.push(supabase.storage.from("payment-qr").remove(files.payment_qr));
  }
  if (files?.maintenance_photos?.length) {
    jobs.push(supabase.storage.from("maintenance-photos").remove(files.maintenance_photos));
  }
  await Promise.allSettled(jobs);
}
