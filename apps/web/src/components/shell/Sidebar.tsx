"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, LogOut, ChevronDown } from "lucide-react";
import { navForUser, ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { signOut } from "@/lib/auth/actions";
import { Brand } from "./Brand";
import { btn } from "@/components/ui/button";

function initials(name: string): string {
  const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
  const parts = clean.split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

export function Sidebar({ role, displayName, modules }: { role: Role; displayName: string; modules: string[] | null }) {
  const pathname = usePathname();
  const items = navForUser(role, modules);
  const name = displayName.replace(/\s*\(.*\)\s*$/, "").trim();

  return (
    <nav
      className="flex h-full w-full shrink-0 flex-col border-r border-line px-[13px] py-[18px]"
      style={{ background: "linear-gradient(180deg,#ffffff,#f6f8fb)" }}
    >
      <div className="px-2 pb-[18px] pt-1">
        <Brand />
      </div>

      <Link
        href="/sales/new?type=invoice"
        className={btn("primary", "lg", "mx-0.5 mb-3.5 gap-2 text-[14px]")}
      >
        <Plus size={17} strokeWidth={2.4} />
        New document
      </Link>

      <div className="flex flex-col gap-[3px] overflow-y-auto">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-11 items-center gap-3 rounded-[10px] px-[13px] text-[13.5px] font-semibold transition-colors ${
                active
                  ? "bg-[rgba(43,140,255,0.10)] text-link"
                  : "text-[#3d4a59] hover:bg-[rgba(15,23,32,0.04)]"
              }`}
            >
              {active && <span className="grad-rail absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-[3px]" />}
              <Icon size={18} strokeWidth={active ? 2.3 : 2} />
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-2.5 rounded-xl border border-line bg-[rgba(15,23,32,0.04)] px-2.5 py-[11px]">
        <span
          className="grid size-[34px] shrink-0 place-items-center rounded-[10px] font-display text-[12px] font-extrabold text-[#3f5065]"
          style={{ background: "linear-gradient(140deg,#e5eaf1,#d2dae4)" }}
        >
          {initials(displayName)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-bold text-ink">{name}</div>
          <div className="text-[11px] font-medium text-muted">{ROLE_LABEL[role]} · Admin</div>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white hover:text-rose"
          >
            <LogOut size={16} />
          </button>
        </form>
        <ChevronDown size={16} className="text-faint" />
      </div>
    </nav>
  );
}
