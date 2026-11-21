import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PayForm } from "@/components/tenant/payments/pay-form";
import { daysUntil, getTenantContext } from "@/lib/tenant";
import { UUID_RE, type PayAccount, type PayInfo } from "@/lib/tenant-payments";

export const instant = false;

function tomorrowISO() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ bill?: string; method?: string }>;
}) {
  const { bill, method } = await searchParams;
  const { supabase, user } = await getTenantContext();

  const { data, error } = await supabase.rpc("tenant_pay_info", {
    p_bill: bill && UUID_RE.test(bill) ? bill : null,
  });

  if (error) {
    if (error.message.includes("not_allowed")) notFound();
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-bold text-slate-900">Pay bill</h1>
        <p className="rounded-xl bg-red-100 p-4 text-sm font-medium text-red-800">
          {error.message.includes("no_lease")
            ? "Join a unit before paying a bill."
            : `Couldn't load this bill. Make sure 014_tenant_payments.sql was run in Supabase. (${error.message})`}
        </p>
      </div>
    );
  }

  const info = data as PayInfo;

  if (!info.has_bill) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[30px] font-bold text-slate-900">Pay bill</h1>
        <p className="rounded-2xl bg-green-100 p-6 text-sm font-medium text-green-800">
          You&apos;re all paid up. There is nothing to pay right now.
        </p>
        <Link href="/tenant/payments" className="w-fit text-sm font-semibold text-sky-700 hover:underline">
          ← Back to payments
        </Link>
      </div>
    );
  }

  // The QR images are in a private bucket, so each one needs a temporary link.
  const paths = info.accounts.map((a) => a.qr_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("payment-qr").createSignedUrls(paths, 3600);
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    });
  }
  const accounts: PayAccount[] = info.accounts.map((a) => ({
    ...a,
    qr_url: a.qr_path ? (urls.get(a.qr_path) ?? null) : null,
  }));

  const b = info.bill;
  const days = daysUntil(b.due_date);
  const dueText =
    days < 0
      ? `${-days} day${-days === 1 ? "" : "s"} overdue`
      : days === 0
        ? "Due today"
        : `Due in ${days} day${days === 1 ? "" : "s"}`;

  await connection();
  const tomorrow = tomorrowISO();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/tenant/payments" className="w-fit text-[13px] font-semibold text-sky-700 hover:underline">
          ← Payments
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-bold text-slate-900">Pay bill</h1>
          <p className="text-[15px] text-slate-500">
            {info.unit_label} · {info.property_name}
          </p>
        </div>
      </div>

      {b.has_pending ? (
        <section className="flex flex-col gap-1 rounded-2xl bg-amber-100 p-6">
          <p className="text-[15px] font-semibold text-amber-800">A payment is already waiting</p>
          <p className="text-sm text-amber-800">
            You already sent a payment for this bill. Your landlord needs to confirm it before you can
            send another.
          </p>
        </section>
      ) : (
        <PayForm
          userId={user.id}
          bill={b}
          accounts={accounts}
          initialMethod={method === "cash" ? "cash" : "online"}
          dueText={dueText}
          defaultPlanned={tomorrow}
        />
      )}
    </div>
  );
}
