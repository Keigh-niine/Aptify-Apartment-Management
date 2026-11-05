import { Logo } from "@/components/logo";
import { SiteButton } from "@/components/site-button";

const features = [
  {
    title: "Rent tracking",
    text: "Due reminders, GCash/Maya payments, and cash payments confirmed by the landlord, with receipts.",
  },
  {
    title: "Maintenance tickets",
    text: "Report issues with photos and follow every update from New to Assigned to Resolved.",
  },
  {
    title: "Announcements",
    text: "Post notices to a whole property or a single unit, so nobody misses what matters.",
  },
  {
    title: "Properties and units",
    text: "Landlords create properties. Tenants join their unit with a code, like joining a class.",
  },
];

const landlordSteps = [
  "Create a property and add its units",
  "Generate an invite code for each unit",
  "Track rent, confirm cash, and resolve tickets",
];

const tenantSteps = [
  "Sign up and enter your unit code",
  "Pay by GCash/Maya or notify a cash payment",
  "Report repairs with photos and follow progress",
];

function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[1440px] px-6 md:px-12 lg:px-20 xl:px-[120px] ${className}`}
    >
      {children}
    </div>
  );
}

function Steps({ title, id, steps }: { title: string; id: string; steps: string[] }) {
  return (
    <div
      id={id}
      className="scroll-mt-8 rounded-[20px] border border-slate-200 bg-white p-6 sm:p-9"
    >
      <h3 className="text-[22px] font-bold text-slate-900">{title}</h3>
      <ol className="mt-6 flex flex-col gap-6">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-700 text-sm font-bold text-white">
              {i + 1}
            </span>
            <span className="text-base font-medium text-slate-900">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Nav */}
      <header className="bg-white py-5">
        <Container className="flex items-center justify-between gap-4">
          <Logo />
          <nav className="hidden items-center gap-9 text-[15px] font-medium text-slate-500 md:flex">
            <a href="#features" className="hover:text-slate-900">Features</a>
            <a href="#how-it-works" className="hover:text-slate-900">How it works</a>
          </nav>
          <div className="flex items-center gap-3">
            <SiteButton href="/login" variant="outline">Log in</SiteButton>
            <SiteButton href="/signup">Get started</SiteButton>
          </div>
        </Container>
      </header>

      {/* Hero */}
      <section className="bg-sky-50 py-14 lg:py-[88px]">
        <Container className="flex flex-col items-center gap-12 lg:flex-row lg:gap-16">
          <div className="flex w-full flex-col items-start gap-6 lg:w-[620px] lg:shrink-0">
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
              Apartment management, simplified
            </span>
            <h1 className="text-4xl font-bold leading-tight text-slate-900 sm:text-5xl lg:text-[56px] lg:leading-[64px]">
              Rent, repairs, and announcements in one place.
            </h1>
            <p className="max-w-[560px] text-lg leading-7 text-slate-500">
              Aptify helps landlords and tenants track rent, handle maintenance requests, and
              share updates without paper trails or lost messages.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <SiteButton href="/signup?role=landlord" size="lg">Create a property</SiteButton>
              <SiteButton href="/signup?role=tenant" size="lg" variant="outline">
                Join a unit with a code
              </SiteButton>
            </div>
          </div>

          {/* Tenant preview card */}
          <div className="flex w-full flex-col gap-5 rounded-[20px] border border-slate-200 bg-white p-6 sm:p-7 lg:w-[560px]">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <p className="text-xl font-bold text-slate-900">My Home</p>
                <p className="text-[13px] text-slate-500">Unit 2C · Mabini Residences</p>
              </div>
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                Tenant
              </span>
            </div>

            <div className="flex flex-col gap-3 rounded-[14px] bg-amber-100 p-5">
              <p className="text-[15px] font-semibold text-amber-800">Rent is due in 3 days</p>
              <p className="text-4xl font-bold text-slate-900">₱5,000</p>
              <div className="flex flex-wrap gap-2.5">
                <span className="rounded-[10px] bg-sky-700 px-5 py-[11px] text-sm font-semibold text-white">
                  Pay Online
                </span>
                <span className="rounded-[10px] border border-slate-300 bg-white px-5 py-[11px] text-sm font-semibold text-slate-900">
                  Pay with cash
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-4">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-slate-900">Leaking kitchen faucet</p>
                <p className="text-xs text-slate-500">Plumbing · Medium urgency</p>
              </div>
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                Assigned
              </span>
            </div>

            <div className="flex flex-col gap-1 rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-sky-700">Announcement from your landlord</p>
              <p className="text-sm text-slate-900">
                Water interruption this Saturday, 9:00 AM to 12:00 PM.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-4 bg-white py-16 lg:py-24">
        <Container className="flex flex-col items-center gap-12">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">
              Everything you need to run an apartment
            </h2>
            <p className="text-lg text-slate-500">
              Built from what tenants and landlords told us they need.
            </p>
          </div>
          <div className="grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-7"
              >
                <div className="flex size-12 items-center justify-center rounded-xl bg-sky-100">
                  <div className="size-5 rounded-md bg-sky-700" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{f.title}</h3>
                <p className="text-[15px] leading-[22px] text-slate-500">{f.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-4 bg-slate-50 py-16 lg:py-24">
        <Container className="flex flex-col items-center gap-12">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl">How it works</h2>
          <div className="grid w-full gap-8 md:grid-cols-2">
            <Steps id="for-landlords" title="For landlords" steps={landlordSteps} />
            <Steps id="for-tenants" title="For tenants" steps={tenantSteps} />
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="bg-sky-700 py-16 lg:py-20">
        <Container className="flex flex-col items-center gap-6 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-[40px]">
            Ready to simplify your apartment?
          </h2>
          <p className="text-lg text-sky-200">
            Create your property in minutes, or join your unit with a code.
          </p>
          <SiteButton href="/signup" size="lg" variant="outline">Get started</SiteButton>
        </Container>
      </section>

      {/* Footer */}
      <footer className="bg-white py-8 text-sm text-slate-500">
        <Container className="flex flex-col items-center justify-between gap-2 md:flex-row">
          <p className="font-medium">Aptify · Apartment Management System</p>
          <p>TechUp · Rizal Technological University</p>
        </Container>
      </footer>
    </div>
  );
}