"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Bell, Menu } from "lucide-react";
import { NAV } from "@/lib/auth/roles";
import { GlobalSearch } from "./GlobalSearch";
import type { NotifItem } from "@/lib/supabase/queries/notifications";

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

const TONE: Record<string, string> = { warn: "#b07c14", danger: "#d63b50", info: "#2b8cff" };

export function Topbar({
  onMenu,
  notifications,
  fiscalYears = [],
}: {
  onMenu?: () => void;
  notifications: Promise<NotifItem[]>;
  fiscalYears?: { label: string; from: string; to: string }[];
}) {
  const pathname = usePathname();
  const [menu, setMenu] = useState<null | "notif" | "fy">(null);
  const match = NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  const title = match?.label ?? "Carfectionist";
  const sub = match ? (SUBS[match.href] ?? "") : "";
  const fyLabel = fiscalYears[0]?.label ?? "FY";

  return (
    <header
      className="relative flex h-[58px] shrink-0 items-center gap-3 border-b border-line px-4 md:h-[62px] md:gap-4 md:px-6"
      style={{ background: "linear-gradient(180deg,rgba(255,255,255,.92),rgba(246,248,251,.75))" }}
    >
      <button onClick={onMenu} aria-label="Open menu" className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-white text-body md:hidden">
        <Menu size={18} />
      </button>

      <div className="min-w-0 flex-1 md:min-w-[180px] md:flex-none">
        <div className="truncate font-display text-[16px] font-extrabold leading-[1.1] text-ink-strong md:text-[18px]">{title}</div>
        <div className="mt-px hidden truncate text-[11.5px] font-medium text-muted sm:block">{sub}</div>
      </div>

      <GlobalSearch />

      <div className="hidden flex-1 md:block" />

      {/* Fiscal year */}
      <div className="relative z-50 hidden sm:block">
        <button
          onClick={() => setMenu((m) => (m === "fy" ? null : "fy"))}
          className={`flex h-[38px] items-center gap-1.5 rounded-[10px] border bg-white px-3 text-[12.5px] font-semibold text-[#3d4a59] ${menu === "fy" ? "border-brand" : "border-line-2"}`}
        >
          <CalendarDays size={15} className="text-link" />
          {fyLabel}
        </button>
        {menu === "fy" && (
          <div className="absolute right-0 top-[46px] w-52 overflow-hidden rounded-[12px] border border-line bg-card shadow-[0_20px_50px_-15px_rgba(15,23,32,0.35)]">
            <div className="border-b border-line px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-faint">Financial year</div>
            {fiscalYears.map((fy) => (
              <Link key={fy.label} href={`/reports?r=collected&from=${fy.from}&to=${fy.to}`} onClick={() => setMenu(null)} className="flex items-center justify-between px-3 py-2.5 text-[13px] font-semibold text-body hover:bg-sub">
                {fy.label} <span className="text-[11px] font-normal text-faint">Jul–Jun</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="relative z-50">
        <button
          onClick={() => setMenu((m) => (m === "notif" ? null : "notif"))}
          aria-label="Notifications"
          className={`relative grid size-9 place-items-center rounded-[10px] border bg-white text-muted md:size-[38px] ${menu === "notif" ? "border-brand" : "border-line-2"}`}
        >
          <Bell size={17} />
          <Suspense fallback={null}>
            <NotifBadge promise={notifications} />
          </Suspense>
        </button>
        {menu === "notif" && (
          <div className="absolute right-0 top-[46px] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-[13px] border border-line bg-card shadow-[0_20px_50px_-15px_rgba(15,23,32,0.35)]">
            <div className="border-b border-line px-4 py-2.5 font-display text-[13px] font-bold text-ink-strong">Notifications</div>
            <Suspense fallback={<div className="px-4 py-8 text-center text-[12.5px] text-faint">Checking…</div>}>
              <NotifList promise={notifications} onGo={() => setMenu(null)} />
            </Suspense>
          </div>
        )}
      </div>

      {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}
    </header>
  );
}

/** The count badge. Suspends alone, so the bell button is on screen immediately. */
function NotifBadge({ promise }: { promise: Promise<NotifItem[]> }) {
  const items = use(promise);
  if (items.length === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full bg-pink px-1 text-[9px] font-bold text-white">
      {items.length}
    </span>
  );
}

/** The dropdown's contents — only resolved once you actually open it. */
function NotifList({ promise, onGo }: { promise: Promise<NotifItem[]>; onGo: () => void }) {
  const items = use(promise);
  if (items.length === 0) return <div className="px-4 py-8 text-center text-[12.5px] text-faint">You&apos;re all caught up ✨</div>;
  return (
    <>
      {items.map((n) => (
        <Link key={n.key} href={n.href} onClick={onGo} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-sub">
          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: TONE[n.tone] }} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">{n.label}</div>
            <div className="text-[11.5px] text-muted">{n.detail}</div>
          </div>
        </Link>
      ))}
    </>
  );
}
