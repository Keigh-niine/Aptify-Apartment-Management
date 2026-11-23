"use client";

import { useRef, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/client";
import {
  generateUnits,
  inviteErrorMessage,
  otpErrorMessage,
  signUpErrorMessage,
  UNVERIFIED_SIGNUP_TTL_MINUTES,
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
import { VerifyStep } from "./verify-step";

type Step = "account" | "tenant" | "property" | "units" | "review" | "verify";

// needsOtp: the sign up email was sent and the person must enter the code first.
type AccountResult = { ok: true } | { ok: false; message: string | null; needsOtp?: boolean };

// What to do once the email is verified.
type Pending = { kind: "join"; code: string } | { kind: "create" };

const emptyProperty: PropertyData = {
  name: "",
  street: "",
  city: "",
  province: "",
  type: "apartment_building",
  unitCount: 12,
};

// Full page load, same as the login form: it avoids carrying App Router data from
// before the session existed, which can send a new landlord to the tenant page.
function goToDashboard() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/dashboard");
}

export function SignupFlow({
  initialRole,
  initialCode = "",
}: {
  initialRole: Role;
  initialCode?: string;
}) {
  const [step, setStep] = useState<Step>("account");
  const [account, setAccount] = useState<AccountValues | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [property, setProperty] = useState<PropertyData>(emptyProperty);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending | null>(null);

  // The account is only created at the very end, so nothing is saved if someone
  // abandons the flow. signUpSentAt stops us from emailing a second code on retry, but only
  // while the pending account can still exist: a database job deletes unverified accounts
  // after UNVERIFIED_SIGNUP_TTL_MINUTES, after which we must sign up again.
  // accountVerified means the code was entered (or Confirm email is off).
  const signUpSentAt = useRef<number | null>(null);
  const accountVerified = useRef(false);

  function signUpIsPending() {
    return (
      signUpSentAt.current !== null &&
      Date.now() - signUpSentAt.current < UNVERIFIED_SIGNUP_TTL_MINUTES * 60_000
    );
  }

  async function ensureAccount(): Promise<AccountResult> {
    if (accountVerified.current) return { ok: true };
    if (!account) return { ok: false, message: "Something went wrong. Please start again." };

    const supabase = createClient();

    if (!signUpIsPending()) {
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
        return { ok: false, message: signUpErrorMessage(error) };
      }

      // With Confirm email on, Supabase hides existing emails: it returns a user with
      // no identities and sends nothing. Treat that as "already exists".
      if (data.user && data.user.identities?.length === 0) {
        setEmailError("An account with this email already exists.");
        setStep("account");
        return { ok: false, message: null };
      }

      signUpSentAt.current = Date.now();

      // Confirm email is off: Supabase signed the person in right away.
      if (data.session) {
        accountVerified.current = true;
        return { ok: true };
      }
    }

    return { ok: false, message: null, needsOtp: true };
  }

  // Runs after the account exists and is verified.
  async function finish(action: Pending): Promise<string | null> {
    const supabase = createClient();

    if (action.kind === "join") {
      const { data, error } = await supabase.rpc("redeem_invite", { p_code: action.code });
      if (error) return inviteErrorMessage(error.message);
      // A bad code comes back as null (not an error), so failed guesses can be counted.
      if (!data) return inviteErrorMessage("invalid_invite_code");
    } else {
      const { error } = await supabase.rpc("create_property", {
        p_name: property.name,
        p_street: property.street,
        p_city: property.city,
        p_province: property.province,
        p_type: property.type,
        p_unit_labels: units.map((u) => u.label.trim()),
      });
      if (error) return "We couldn't create your property. Please try again.";
    }

    goToDashboard();
    return null;
  }

  function startVerify(action: Pending) {
    setPending(action);
    setStep("verify");
  }

  async function joinUnit(code: string): Promise<string | null> {
    const action: Pending = { kind: "join", code };
    const acc = await ensureAccount();
    if (!acc.ok) {
      if (acc.needsOtp) startVerify(action);
      return acc.message;
    }
    return finish(action);
  }

  async function createProperty() {
    setCreateError(null);
    setCreating(true);
    const action: Pending = { kind: "create" };

    const acc = await ensureAccount();
    if (!acc.ok) {
      if (acc.needsOtp) startVerify(action);
      else if (acc.message) setCreateError(acc.message);
      setCreating(false);
      return;
    }

    const message = await finish(action);
    if (message) {
      setCreateError(message);
      setCreating(false);
    }
  }

  async function verifyCode(token: string): Promise<string | null> {
    if (!account) return "Something went wrong. Please start again.";

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: account.email,
      token,
      type: "signup",
    });
    if (error) return otpErrorMessage(error);

    accountVerified.current = true;

    // Finish what the person started. If it fails, send them back to that step.
    const action = pending;
    if (!action) {
      goToDashboard();
      return null;
    }

    const message = await finish(action);
    if (message) {
      if (action.kind === "join") {
        setJoinError(message);
        setStep("tenant");
      } else {
        setCreateError(message);
        setCreating(false);
        setStep("review");
      }
    }
    return null;
  }

  // Unverified accounts are deleted by a database job shortly after the TTL passes
  // (see cleanup-unverified-signups.sql). auth.resend() fails once the
  // account is gone, so resend with signUp instead: it emails a new code to a still-pending
  // account, and quietly creates the account again if the old one was cleaned up.
  async function resendCode(): Promise<string | null> {
    if (!account) return "Something went wrong. Please start again.";

    const { data, error } = await createClient().auth.signUp({
      email: account.email,
      password: account.password,
      options: { data: { first_name: account.firstName, last_name: account.lastName } },
    });
    if (error) return signUpErrorMessage(error);

    // No identities means the email now belongs to a verified account.
    if (data.user && data.user.identities?.length === 0) {
      return "An account with this email already exists. Go back and log in instead.";
    }

    // A fresh code was sent (or the account was recreated): restart the clock.
    signUpSentAt.current = Date.now();
    return null;
  }

  function onAccountNext(values: AccountValues) {
    // New email or password means the earlier sign up no longer matches.
    if (values.email !== account?.email || values.password !== account?.password) {
      signUpSentAt.current = null;
    }
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

  if (step === "verify") {
    return (
      <AuthShell
        heading="Check your email."
        text="We send a one-time code to confirm the address is yours before your account is created."
        bullets={[
          "The code is sent to the email you signed up with",
          "It expires after a short time",
          "Didn't get it? Request a new code",
        ]}
      >
        <VerifyStep
          email={account?.email ?? ""}
          onVerify={verifyCode}
          onResend={resendCode}
          onBack={() => setStep(pending?.kind === "join" ? "tenant" : "review")}
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
        <TenantStep
          email={account?.email ?? ""}
          initialCode={pending?.kind === "join" ? pending.code : initialCode}
          initialError={joinError}
          onBack={() => setStep("account")}
          onJoin={joinUnit}
        />
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