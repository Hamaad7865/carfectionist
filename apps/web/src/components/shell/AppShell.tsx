"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAppliedTheme, restoreSavedTheme } from "@/lib/theme";
import type { SessionContext } from "@/lib/auth/session";
import type { BrandInfo } from "@/lib/brand";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TyreShell } from "@/components/tyrecentre/TyreShell";
import { BottomNav } from "./BottomNav";
import { hasWhatsApp, hiddenModulesFor } from "@/lib/auth/roles";
import { ShopFeaturesProvider } from "./ShopFeatures";
import { useBackToClose } from "./useBackToClose";

export function AppShell({
  ctx,
  brand,
  fiscalYears,
  children,
}: {
  ctx: SessionContext;
  brand: BrandInfo;
  fiscalYears: { label: string; from: string; to: string }[];
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  // Phones: Back closes the drawer instead of leaving the page. Every other way
  // out (X, backdrop, Escape, More, a link) goes through closeNav, which pops the
  // drawer's history entry first.
  const closeNav = useBackToClose(navOpen, () => setNavOpen(false));
  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeNav();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, closeNav]);
  // Dark mode belongs to the back office only: re-apply the saved choice on
  // entry (a client navigation in from /login skips the layout's inline
  // script) and drop it on the way out, so login and public pages stay light.
  const followSystem = brand.key === "tyrecentre";
  useEffect(() => {
    restoreSavedTheme(followSystem);
    return clearAppliedTheme;
  }, [followSystem]);

  if (brand.key === "tyrecentre") {
    return (
      <TyreShell ctx={ctx} brand={brand}>
        <ShopFeaturesProvider whatsapp={hasWhatsApp(ctx.tenantId)}>{children}</ShopFeaturesProvider>
      </TyreShell>
    );
  }

  return (
    // Pinned to the window (not h-dvh): anything that makes the document taller — a popover, a
    // zoomed browser — then scrolls an empty body behind the shell instead of sliding the whole
    // shell up and leaving a blank strip under it.
    <div className="fixed inset-0 flex overflow-hidden bg-app">
      {/* Desktop sidebar (fixed) */}
      <div className="hidden md:flex md:w-[256px] md:shrink-0">
        <Sidebar brand={brand} role={ctx.role} displayName={ctx.displayName} modules={ctx.modules} hidden={hiddenModulesFor(ctx.tenantId)} />
      </div>

      {/* Phone menu ("More" in the tab bar): the full sidebar as a drawer. */}
      {navOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-[rgba(15,23,32,0.45)] backdrop-blur-[1px]" onClick={() => closeNav()} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 w-[300px] max-w-[86%] shadow-[0_20px_60px_-10px_rgba(15,23,32,0.5)]"
            style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <Sidebar
              brand={brand}
              role={ctx.role}
              displayName={ctx.displayName}
              modules={ctx.modules}
              hidden={hiddenModulesFor(ctx.tenantId)}
              onClose={() => closeNav()}
              onNavigate={(href) => closeNav(() => router.push(href))}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar brand={brand} fiscalYears={fiscalYears} />
        <main
          className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          style={{ background: "radial-gradient(900px 500px at 100% 0%, rgba(43,140,255,.045), transparent 60%)" }}
        >
          <ShopFeaturesProvider whatsapp={hasWhatsApp(ctx.tenantId)}>{children}</ShopFeaturesProvider>
        </main>
        <BottomNav
          role={ctx.role}
          modules={ctx.modules}
          hidden={hiddenModulesFor(ctx.tenantId)}
          menuOpen={navOpen}
          onMore={() => (navOpen ? closeNav() : setNavOpen(true))}
        />
      </div>
    </div>
  );
}
