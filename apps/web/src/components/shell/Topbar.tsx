"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Bell, Menu, X } from "lucide-react";
import { NAV } from "@/lib/auth/roles";
import { GlobalSearch } from "./GlobalSearch";
import { dismissNotificationAction, dismissAllNotificationsAction } from "@/features/shell/notification-actions";
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
  "/sales-journal": "Period sales, broken down five ways",
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
  const { items: notifications, dismiss, dismissAll } = useLiveNotifications(pathname);
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
          <div className="absolute right-0 top-[46px] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-[13px] border border-line bg-card shadow-[0_20px_50px_-15px_rgba(15,23,32,0.35)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="font-display text-[13px] font-bold text-ink-strong">Notifications</span>
              <div className="flex-1" />
              {notifications.length > 0 && (
                <button onClick={() => void dismissAll()} className="text-[11.5px] font-semibold text-link hover:underline">
                  Clear all
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-faint">You&apos;re all caught up ✨</div>
            ) : (
              <>
                {notifications.map((n) => (
                  <div key={n.key} className="flex items-start border-b border-line last:border-b-0 hover:bg-sub">
                    {/* Opening it counts as seeing it — that is what "I clicked
                        it, why is it still there?" was asking for. */}
                    <Link
                      href={n.href}
                      onClick={() => {
                        setMenu(null);
                        void dismiss(n.key);
                      }}
                      className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4"
                    >
                      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: TONE[n.tone] }} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink">{n.label}</div>
                        <div className="text-[11.5px] text-muted">{n.detail}</div>
                      </div>
                    </Link>
                    <button
                      onClick={() => void dismiss(n.key)}
                      aria-label={`Clear: ${n.label}`}
                      className="mx-1.5 mt-2.5 grid size-7 shrink-0 place-items-center rounded-[8px] text-faint hover:bg-band hover:text-body"
                    >
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
                <p className="bg-band px-4 py-2 text-[10.5px] leading-snug text-faint">
                  Cleared alerts come back tomorrow if they are still true — or sooner if they grow.
                </p>
              </>
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
 *  These are LIVE conditions, not messages: "11 products low at the shop" is
 *  true until someone restocks. So the alerts are recomputed from the ledger
 *  every time, and a dismissal is remembered separately — it says "I have seen
 *  this today", and it lapses tomorrow or as soon as the alert grows.
 *
 *  Asking happens on mount, on every navigation (you just did something —
 *  billed, restocked, replied — so the answer may have changed), and on a slow
 *  timer for the screen someone leaves open at the desk all day. This used to
 *  live in the app layout, which does NOT re-run on client navigation: that is
 *  why the badge froze at whatever it said on first load.
 */
function useLiveNotifications(pathname: string) {
  const [items, setItems] = useState<NotifItem[]>([]);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/notifications", { signal, cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: NotifItem[] };
      setItems(data.items ?? []);
    } catch {
      /* offline or aborted — keep showing the last known answer */
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => void reload(controller.signal);
    load();
    const timer = setInterval(load, 90_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pathname, reload]); // re-ask whenever the route changes

  // Clear optimistically — the badge must drop the instant you click, not a
  // round trip later. Then re-ask: if the write failed, the alert comes back,
  // which is the honest outcome.
  const dismiss = useCallback(
    async (key: string) => {
      setItems((cur) => cur.filter((i) => i.key !== key));
      await dismissNotificationAction({ key });
      await reload();
    },
    [reload],
  );

  const dismissAll = useCallback(async () => {
    setItems([]);
    await dismissAllNotificationsAction();
    await reload();
  }, [reload]);

  return { items, dismiss, dismissAll };
}
