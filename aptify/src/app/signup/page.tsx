import { redirect } from "next/navigation";
import { SignupFlow } from "@/components/auth/signup/signup-flow";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; code?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const { role, code } = await searchParams;
  return (
    <SignupFlow
      initialRole={role === "landlord" ? "landlord" : "tenant"}
      initialCode={(code ?? "").slice(0, 20)}
    />
  );
}
