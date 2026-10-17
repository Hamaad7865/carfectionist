"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, LogOut, ChevronDown } from "lucide-react";
import { groupNav, navForUser, ROLE_LABEL, type NavGroupKey, type Role } from "@/lib/auth/roles";
import { signOut } from "@/lib/auth/actions";
import { Brand } from "./Brand";
import { btn } from "@/components/ui/button";
import { ANIMATED_NAV_ICONS } from "./NavIcons";

const COLLAPSED_KEY = "sidebar-collapsed";

function initials(name: string): string {
  const clean = name.replace(/\s*\(.*\)\s*$/, "").trim();
  const parts = clean.split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return letters.toUpperCase();
}

export function Sidebar({ role, displayName, modules }: { role: Role; displayName: string; modules: string[] | null }) {
  const pathname = usePathname();
  const sections = groupNav(navForUser(role, modules));
  const name = displayName.replace(/\s*\(.*\)\s*$/, "").trim();

  // Folded sections are remembered per browser; the section holding the open
  // page always shows, so you never lose where you are.
  const [collapsed, setCollapsed] = useState<NavGroupKey[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after hydration
      if (Array.isArray(saved)) setCollapsed(saved);
    } catch {
      /* storage blocked — every section stays open */
    }
  }, []);
  function toggle(key: NavGroupKey) {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* not remembered — fine */
      }
      return next;
    });
  }
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex h-full w-full shrink-0 flex-col border-r border-line bg-linear-to-b from-card to-sub px-[13px] py-[18px]">
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

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 pb-3">
        {sections.map((section) => {
          const holdsActive = section.items.some((i) => isActive(i.href));
          const open = !section.label || holdsActive || !collapsed.includes(section.key);
          return (
            <div key={section.key} className={section.label ? "pt-1.5" : undefined}>
              {section.label && (
                <button
                  type="button"
                  onClick={() => toggle(section.key)}
                  aria-expanded={open}
                  className="flex h-6 w-full items-center gap-1 rounded-[8px] px-[13px] text-[10.5px] font-bold uppercase tracking-[0.12em] text-fainter transition-colors hover:text-muted"
                >
                  <span className="flex-1 text-left">{section.label}</span>
                  <ChevronDown size={13} strokeWidth={2.4} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
                </button>
              )}
              {open && (
                <div className="flex flex-col gap-[2px]">
                  {section.items.map((item) => {
                    const active = isActive(item.href);
                    // Each icon has its own bespoke hover animation (see NavIcons.tsx) —
                    // the certificate's tick draws in, the report's bars grow, the truck
                    // rolls in, and so on — rather than one generic effect on all of them.
                    const Icon = ANIMATED_NAV_ICONS[item.href] ?? item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`group relative flex h-9 items-center gap-3 rounded-[10px] px-[13px] text-[13.5px] font-semibold transition-colors ${
                          active ? "bg-brand/10 text-link" : "text-th hover:bg-shade/4"
                        }`}
                      >
                        {active && <span className="grad-rail absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-[3px]" />}
                        <Icon size={18} strokeWidth={active ? 2.3 : 2} className="shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex shrink-0 items-center gap-2.5 rounded-xl border border-line bg-shade/4 px-2.5 py-[11px]">
        <span
          className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-band font-display text-[12px] font-extrabold text-th"
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
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-card hover:text-rose"
          >
            <LogOut size={16} />
          </button>
        </form>
        <ChevronDown size={16} className="text-faint" />
      </div>
    </nav>
  );
}
