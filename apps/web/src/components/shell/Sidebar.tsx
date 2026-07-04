"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { navForRole, ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { signOut } from "@/lib/auth/actions";
import { Brand } from "./Brand";

function initials(name: string): string {
  const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
  const parts = clean.split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

export function Sidebar({ role, displayName }: { role: Role; displayName: string }) {
  const pathname = usePathname();
  const items = navForRole(role);
  const name = displayName.replace(/\s*\(.*\)\s*$/, "").trim();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-graphite-700 bg-graphite-900">
      <div className="flex h-14 items-center border-b border-graphite-700 px-5">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-10 items-center gap-3 px-5 text-[13px] transition-colors ${
                active
                  ? "bg-graphite-850 text-teal"
                  : "text-graphite-400 hover:bg-graphite-850/60 hover:text-graphite-100"
              }`}
            >
              {active && (
                <span className="iris-rail absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full" />
              )}
              <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
              <span className={active ? "font-medium" : undefined}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-graphite-700 p-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-graphite-800 font-display text-sm font-semibold text-teal">
            {initials(displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-graphite-100">{name}</p>
            <p className="text-[11px] text-graphite-500">{ROLE_LABEL[role]}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              className="grid size-8 place-items-center rounded-md text-graphite-500 transition-colors hover:bg-graphite-800 hover:text-danger"
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
