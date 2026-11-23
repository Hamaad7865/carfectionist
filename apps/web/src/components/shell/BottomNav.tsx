"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { navForUser, type NavItem, type Role } from "@/lib/auth/roles";

/** The pages someone on a phone opens most, in the order the tab bar shows them.
 *  A user who cannot open one of these gets the next page their role allows. */
const PREFERRED = ["/dashboard", "/jobs", "/sales", "/reports", "/sales-journal", "/contacts", "/appointments", "/products"];

/** Short names that fit under a tab icon on a 320px screen. */
const SHORT: Record<string, string> = {
  "/dashboard": "Home",
  "/jobs": "Jobs",
  "/sales": "Sales",
  "/reports": "Reports",
  "/sales-journal": "Journal",
  "/contacts": "Contacts",
  "/appointments": "Bookings",
  "/products": "Stock",
};

/** The four tabs this user gets. Exported for the test. */
export function bottomTabs(items: NavItem[]): NavItem[] {
  const byHref = new Map(items.map((i) => [i.href, i]));
  const picked = PREFERRED.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i);
  for (const i of items) if (!picked.includes(i)) picked.push(i);
  return picked.slice(0, 4);
}

/** Phone tab bar: the four most-used pages, plus "More" for the full menu.
 *  Hidden from md up, where the sidebar is always on screen. */
export function BottomNav({
  role,
  modules,
  hidden = [],
  menuOpen,
  onMore,
}: {
  role: Role;
  modules: string[] | null;
  hidden?: readonly string[];
  menuOpen: boolean;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const tabs = bottomTabs(navForUser(role, modules).filter((i) => !hidden.includes(i.href)));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const onTab = tabs.some((t) => isActive(t.href));

  const cell =
    "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] pt-2 pb-1.5 text-[10.5px] font-bold tracking-[0.01em] transition-colors";

  return (
    <nav
      aria-label="Main"
      className="relative z-30 flex shrink-0 border-t border-line bg-card/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
        const active = isActive(t.href) && !menuOpen;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`${cell} ${active ? "text-link" : "text-muted"}`}
          >
            {active && <span className="grad-rail absolute inset-x-[30%] top-0 h-[3px] rounded-b-[3px]" />}
            <Icon size={21} strokeWidth={active ? 2.3 : 1.9} />
            <span className="max-w-full truncate px-1">{SHORT[t.href] ?? t.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-expanded={menuOpen}
        className={`${cell} ${menuOpen || !onTab ? "text-link" : "text-muted"}`}
      >
        {(menuOpen || !onTab) && <span className="grad-rail absolute inset-x-[30%] top-0 h-[3px] rounded-b-[3px]" />}
        <LayoutGrid size={21} strokeWidth={menuOpen || !onTab ? 2.3 : 1.9} />
        <span>More</span>
      </button>
    </nav>
  );
}
