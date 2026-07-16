"use client";

import { useEffect, useState } from "react";
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
  fiscalYears = [],
}: {
  onMenu?: () => void;
  fiscalYears?: { label: string; from: string; to: string }[];
}) {
  const pathname = usePathname();
  const [menu, setMenu] = useState<null | "notif" | "fy">(null);
  const notifications = useLiveNotifications(pathname);
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
          {notifications.length > 0 && (
            <span className="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full bg-pink px-1 text-[9px] font-bold text-white">
              {notifications.length}
            </span>
          )}
        </button>
        {menu === "notif" && (
          <div className="absolute right-0 top-[46px] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-[13px] border border-line bg-card shadow-[0_20px_50px_-15px_rgba(15,23,32,0.35)]">
            <div className="border-b border-line px-4 py-2.5 font-display text-[13px] font-bold text-ink-strong">Notifications</div>
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-faint">You&apos;re all caught up ✨</div>
            ) : (
              notifications.map((n) => (
                <Link key={n.key} href={n.href} onClick={() => setMenu(null)} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-sub">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: TONE[n.tone] }} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{n.label}</div>
                    <div className="text-[11.5px] text-muted">{n.detail}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </div>

      {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}
    </header>
  );
}

/** Keeps the bell honest.
 *
 *  These are LIVE conditions, not messages: "11 products low at the shop" is true
 *  until you restock, so clicking it can't dismiss it — fixing the stock does.
 *  What was broken is that nothing re-asked: the alerts were computed in the app
 *  layout, and a layout doesn't re-run on client navigation, so the badge froze
 *  at whatever it said on first load and stayed there until a hard refresh.
 *
 *  So: ask on mount, ask again on every navigation (you just did something —
 *  billed, restocked, replied — so the answer may have changed), and ask on a
 *  slow timer for the screen someone leaves open at the desk all day.
 */
function useLiveNotifications(pathname: string): NotifItem[] {
  const [items, setItems] = useState<NotifItem[]>([]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const res = await fetch("/api/notifications", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: NotifItem[] };
        if (alive) setItems(data.items ?? []);
      } catch {
        /* offline or aborted — keep showing the last known answer */
      }
    };

    void load();
    const timer = setInterval(load, 90_000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [pathname]); // re-ask whenever the route changes

  return items;
}
