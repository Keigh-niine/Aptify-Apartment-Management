"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { House, LogOut, Megaphone, Receipt, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const nav = [
  { href: "/tenant", label: "Home", icon: House, exact: true },
  { href: "/tenant/payments", label: "Payments", icon: Receipt },
  { href: "/tenant/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/tenant/announcements", label: "Announcements", icon: Megaphone },
];

export function TenantSidebar({
  initials,
  firstName,
  propertyName,
}: {
  initials: string;
  firstName: string;
  propertyName: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const label = `whitespace-nowrap transition-opacity duration-200 motion-reduce:transition-none max-md:opacity-0 ${
    collapsed ? "opacity-0" : "opacity-100 delay-100"
  }`;

  async function logOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white px-5 py-6 transition-[width] duration-300 ease-in-out motion-reduce:transition-none ${
        collapsed ? "w-[77px]" : "w-[241px] max-md:w-[77px]"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="mb-5 flex cursor-pointer items-center gap-2.5 rounded-[10px] text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sky-700 text-xl font-bold text-white">
          A
        </span>
        <span className={`text-[22px] font-bold text-slate-900 ${label}`}>Aptify</span>
      </button>

      <nav className="flex flex-col gap-1.5">
        {nav.map(({ href, label: text, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? text : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-[10px] px-2 py-2.5 text-[15px] transition-colors ${
                active
                  ? "bg-sky-100 font-semibold text-sky-700"
                  : "font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className={label}>{text}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={logOut}
        title={collapsed ? "Log out" : undefined}
        className="mb-3 flex cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2.5 text-[15px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
      >
        <LogOut className="size-5 shrink-0" aria-hidden />
        <span className={label}>Log out</span>
      </button>

      <div className="flex items-center gap-2.5" title={collapsed ? firstName : undefined}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[13px] font-bold text-sky-700">
          {initials}
        </span>
        <div className={`flex min-w-0 flex-col ${label}`}>
          <p className="max-w-[140px] truncate text-sm font-semibold text-slate-900">{firstName}</p>
          <p className="max-w-[140px] truncate text-xs text-slate-500">{propertyName}</p>
        </div>
      </div>
    </aside>
  );
}