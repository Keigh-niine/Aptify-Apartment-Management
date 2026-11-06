"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/client";
import {
  generateUnits,
  inviteErrorMessage,
  type AccountValues,
  type PropertyData,
  type Role,
  type UnitItem,
} from "@/lib/signup";
import { AccountStep } from "./account-step";
import { PropertyStep } from "./property-step";
import { ReviewStep } from "./review-step";
import { TenantStep } from "./tenant-step";
import { UnitsStep } from "./units-step";

type Step = "account" | "tenant" | "property" | "units" | "review";

type AccountResult = { ok: true } | { ok: false; message: string | null };

const emptyProperty: PropertyData = {
  name: "",
  street: "",
  city: "",
  province: "",
  type: "apartment_building",
  unitCount: 12,
};

export function SignupFlow({ initialRole }: { initialRole: Role }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("account");
  const [account, setAccount] = useState<AccountValues | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [property, setProperty] = useState<PropertyData>(emptyProperty);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The account is only created at the very end of step 2, so nothing is
  // saved if someone abandons the flow. This prevents creating it twice on retry.
  const accountCreated = useRef(false);

  async function ensureAccount(): Promise<AccountResult> {
    if (accountCreated.current) return { ok: true };
    if (!account) return { ok: false, message: "Something went wrong. Please start again." };

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: account.email,
      password: account.password,
      options: { data: { first_name: account.firstName, last_name: account.lastName } },
    });

    if (error) {
      if (error.code === "user_already_exists" || /already registered/i.test(error.message)) {
        setEmailError("An account with this email already exists.");
        setStep("account");
        return { ok: false, message: null };
      }
      return { ok: false, message: "We couldn't create your account. Please try again." };
    }

    accountCreated.current = true;

    if (!data.session) {
      return {
        ok: false,
        message:
          "Your account was created but you are not signed in. In Supabase, turn off “Confirm email” (Authentication → Sign In / Providers → Email) while developing, then log in.",
      };
    }
    return { ok: true };
  }

  async function joinUnit(code: string): Promise<string | null> {
    const acc = await ensureAccount();
    if (!acc.ok) return acc.message;

    const supabase = createClient();
    const { error } = await supabase.rpc("redeem_invite", { p_code: code });
    if (error) return inviteErrorMessage(error.message);

    router.push("/dashboard");
    router.refresh();
    return null;
  }

  async function createProperty() {
    setCreateError(null);
    setCreating(true);

    const acc = await ensureAccount();
    if (!acc.ok) {
      setCreateError(acc.message);
      setCreating(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.rpc("create_property", {
      p_name: property.name,
      p_street: property.street,
      p_city: property.city,
      p_province: property.province,
      p_type: property.type,
      p_unit_labels: units.map((u) => u.label.trim()),
    });

    if (error) {
      setCreateError("We couldn't create your property. Please try again.");
      setCreating(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  function onAccountNext(values: AccountValues) {
    setAccount(values);
    setEmailError(undefined);
    setStep(values.role === "tenant" ? "tenant" : "property");
  }

  function onPropertyNext(data: PropertyData) {
    // Seed the unit list from "Number of units" if it is new or the number changed.
    if (units.length === 0 || data.unitCount !== property.unitCount) {
      const perFloor = Math.min(4, data.unitCount);
      const floors = Math.ceil(data.unitCount / perFloor);
      setUnits(generateUnits(floors, perFloor, data.unitCount));
    }
    setProperty(data);
    setStep("units");
  }

  if (step === "account") {
    return (
      <AuthShell
        heading="Create your account."
        text="Tell us who you are. Next, tenants join their unit and landlords set up theirs."
        bullets={[
          "Tenants join a unit with an invite code",
          "Landlords create their unit during sign up",
          "Pay rent and track repairs in one place",
        ]}
      >
        <AccountStep
          initial={account}
          initialRole={initialRole}
          emailError={emailError}
          onNext={onAccountNext}
        />
      </AuthShell>
    );
  }

  if (step === "tenant") {
    return (
      <AuthShell
        heading="Join your unit."
        text="Enter the invite code from your landlord to finish creating your tenant account."
        bullets={[
          "Codes are single-use and expire in 7 days",
          "See your rent and charges right away",
          "Report repairs from day one",
        ]}
      >
        <TenantStep onBack={() => setStep("account")} onJoin={joinUnit} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      variant="wizard"
      heading="Set up your unit."
      text="Add your property and first unit to finish creating your landlord account."
      bullets={[
        "Invite tenants with a single-use code",
        "Set rent and due date once",
        "Add more units any time",
      ]}
    >
      {step === "property" && (
        <PropertyStep
          initial={property}
          onNext={onPropertyNext}
          onCancel={() => setStep("account")}
        />
      )}
      {step === "units" && (
        <UnitsStep
          units={units}
          onChange={setUnits}
          onNext={() => setStep("review")}
          onBack={() => setStep("property")}
        />
      )}
      {step === "review" && (
        <ReviewStep
          property={property}
          units={units}
          error={createError}
          loading={creating}
          onCreate={createProperty}
          onBack={() => setStep("units")}
        />
      )}
    </AuthShell>
  );
}
