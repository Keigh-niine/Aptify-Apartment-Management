import { Logo } from "@/components/logo";

type Props = {
  heading: string;
  text: string;
  bullets: string[];
  variant?: "split" | "wizard";
  children: React.ReactNode;
};

export function AuthShell({ heading, text, bullets, variant = "split", children }: Props) {
  const wizard = variant === "wizard";

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside
        className={`flex flex-col justify-center gap-6 bg-sky-700 px-6 py-8 ${
          wizard ? "lg:w-[362px] lg:shrink-0 lg:px-10 lg:py-20" : "lg:w-1/2 lg:p-20"
        }`}
      >
        <Logo inverted />
        <h1
          className={
            wizard
              ? "text-2xl font-bold text-white lg:text-[32px]"
              : "text-3xl font-bold text-white lg:text-[52px] lg:leading-[1.15]"
          }
        >
          {heading}
        </h1>
        <p className="hidden max-w-[520px] text-lg text-sky-200 lg:block">{text}</p>
        <ul className="hidden flex-col gap-3.5 lg:flex">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-3 text-base font-medium text-white">
              <span className="size-2.5 shrink-0 rounded-full bg-sky-300" />
              {b}
            </li>
          ))}
        </ul>
      </aside>

      <main
        className={
          wizard
            ? "flex-1 bg-slate-100 p-6 lg:p-10"
            : "flex flex-1 items-center justify-center bg-white px-6 py-10 lg:p-20"
        }
      >
        {children}
      </main>
    </div>
  );
}
