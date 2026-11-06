"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { accountSchema, type AccountValues, type Role } from "@/lib/signup";
import { Field } from "../field";
import { StepIndicator } from "./wizard-parts";

const roles: { value: Role; title: string; sub: string }[] = [
  { value: "tenant", title: "Tenant", sub: "I rent a unit" },
  { value: "landlord", title: "Landlord", sub: "I own or manage a property" },
];

export function AccountStep({
  initial,
  initialRole,
  emailError,
  onNext,
}: {
  initial: AccountValues | null;
  initialRole: Role;
  emailError?: string;
  onNext: (values: AccountValues) => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: initial ?? {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: initialRole,
    },
  });

  useEffect(() => {
    if (emailError) setError("email", { message: emailError });
  }, [emailError, setError]);

  const role = watch("role");

  return (
    <form onSubmit={handleSubmit(onNext)} noValidate className="flex w-full max-w-[400px] flex-col gap-5">
      <StepIndicator step={1} />

      <div className="flex flex-col gap-1.5">
        <h2 className="text-[32px] font-bold text-slate-900">Sign up</h2>
        <p className="text-[15px] text-slate-500">Create an account to get started.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="First name"
          autoComplete="given-name"
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <Field
          label="Last name"
          autoComplete="family-name"
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <Field
        label="Email address"
        type="email"
        autoComplete="email"
        placeholder="you@email.com"
        error={errors.email?.message}
        {...register("email")}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters."
        error={errors.password?.message}
        {...register("password")}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium text-slate-900">I am a</legend>
        <div className="flex gap-2.5">
          {roles.map((r) => (
            <label
              key={r.value}
              className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-[10px] border border-slate-300 bg-white px-3.5 py-3 has-[:checked]:border-sky-700 has-[:checked]:bg-sky-50"
            >
              <input type="radio" value={r.value} className="peer sr-only" {...register("role")} />
              <span className="size-4 shrink-0 rounded-full border-[1.5px] border-slate-300 bg-white peer-checked:border-[5px] peer-checked:border-sky-700" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-slate-900">{r.title}</span>
                <span className="text-[11px] text-slate-500">{r.sub}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {role === "tenant"
            ? "Next: join your unit with an invite code."
            : "Next: set up your property and units."}
        </p>
      </fieldset>

      <Button type="submit" className="w-full">
        Continue
      </Button>

      <p className="flex justify-center gap-1.5 text-sm text-slate-500">
        Already have an account?
        <Link href="/login" className="font-semibold text-sky-700">
          Log in
        </Link>
      </p>
    </form>
  );
}
