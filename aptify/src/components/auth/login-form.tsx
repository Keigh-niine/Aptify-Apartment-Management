"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { Field } from "./field";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });

    if (error) {
      setError(
        error.code === "invalid_credentials"
          ? "Incorrect email or password. Try again."
          : "Something went wrong. Please try again."
      );
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[32px] font-bold text-slate-900">Log in</h2>
        <p className="text-[15px] text-slate-500">Enter your details to continue.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-[10px] bg-red-100 p-3 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <Field
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@email.com"
        required
        invalid={!!error}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        invalid={!!error}
      />

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Logging in…" : "Log in"}
      </Button>

      <Link href="/forgot-password" className="text-center text-sm font-medium text-sky-700">
        Forgot password?
      </Link>

      <p className="flex justify-center gap-1.5 text-sm text-slate-500">
        New to Aptify?
        <Link href="/signup" className="font-semibold text-sky-700">
          Create an account
        </Link>
      </p>
    </form>
  );
}
