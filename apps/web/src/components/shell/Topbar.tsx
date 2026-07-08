"use client";

import { usePathname } from "next/navigation";
import { Search, CalendarDays, Bell, Menu } from "lucide-react";
import { NAV } from "@/lib/auth/roles";

const SUBS: Record<string, string> = {
  "/dashboard": "Overview of today's activity",
  "/jobs": "Reception, jobs board & job cards",
  "/appointments": "Bookings & scheduling",
  "/contacts": "Customers, vehicles & suppliers",
  "/sales": "Quotes & invoices",
  "/products": "Catalogue & inventory",
  "/certificates": "Warranty certificates",
  "/purchases": "Suppliers, orders & expenses",
  "/reports": "Accounting & reports",
  "/enquiries": "Public enquiry inbox",
  "/settings": "Business, team & templates",
};

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const match = NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  const title = match?.label ?? "Carfectionist";
  const sub = match ? (SUBS[match.href] ?? "") : "";

  return (
    <header
      className="flex h-[58px] shrink-0 items-center gap-3 border-b border-line px-4 md:h-[62px] md:gap-4 md:px-6"
      style={{ background: "linear-gradient(180deg,rgba(255,255,255,.92),rgba(246,248,251,.75))" }}
    >
      <button
        onClick={onMenu}
        aria-label="Open menu"
        className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-white text-body md:hidden"
      >
        <Menu size={18} />
      </button>

      <div className="min-w-0 flex-1 md:min-w-[180px] md:flex-none">
        <div className="truncate font-display text-[16px] font-extrabold leading-[1.1] text-ink-strong md:text-[18px]">{title}</div>
        <div className="mt-px hidden truncate text-[11.5px] font-medium text-muted sm:block">{sub}</div>
      </div>

      <div className="hidden h-10 max-w-[420px] flex-1 items-center gap-2.5 rounded-[11px] border border-line-2 bg-white px-3 md:flex">
        <Search size={16} className="text-faint" />
        <input
          placeholder="Search invoices, customers, vehicles…"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-faint"
        />
        <span className="num rounded-[5px] border border-line-2 px-1.5 py-0.5 text-[10px] text-fainter">⌘K</span>
      </div>

      <div className="hidden flex-1 md:block" />

      <button className="hidden h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-white px-3 text-[12.5px] font-semibold text-[#3d4a59] sm:flex">
        <CalendarDays size={15} className="text-link" />
        FY 2025–26
      </button>
      <button className="relative grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-white text-muted md:size-[38px]">
        <Bell size={17} />
        <span className="absolute right-2 top-2 size-[7px] rounded-full border-[1.5px] border-white bg-pink" />
      </button>
    </header>
  );
}
