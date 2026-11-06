import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      heading="Welcome back."
      text="One account for landlords and tenants. Your role depends on the properties and units you belong to."
      bullets={[
        "Pay rent by GCash/Maya or cash",
        "Report repairs and follow their status",
        "Never miss an announcement",
      ]}
    >
      <LoginForm />
    </AuthShell>
  );
}