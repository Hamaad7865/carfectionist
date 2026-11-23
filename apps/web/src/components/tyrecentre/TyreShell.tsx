"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import type { SessionContext } from "@/lib/auth/session";
import { hasWhatsApp } from "@/lib/auth/roles";
import { ShopFeaturesProvider } from "@/components/shell/ShopFeatures";
import type { BrandInfo } from "@/lib/brand";
import { isNewSalePath, NEW_SALE_HREF, tyreCentreNav } from "@/lib/tyrecentre/nav";
import { getShellStatusAction, type ShellStatus } from "@/features/tyrecentre/shell-actions";
import { TyreSidebar } from "./TyreSidebar";
import { TyreCommandSearch } from "./TyreCommandSearch";
import { TyreTopbar } from "./TyreTopbar";

/** The tyre-centre back office frame: shadcn sidebar, the Easy UI-styled top bar, then the
 *  page. Carfectionist keeps AppShell. */
export function TyreShell({ ctx, brand, children }: { ctx: SessionContext; brand: BrandInfo; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useMemo(() => tyreCentreNav(ctx.role, ctx.modules, ctx.tenantId), [ctx.role, ctx.modules, ctx.tenantId]);
  const newSale = isNewSalePath(pathname);
  const [open, setOpen] = useState(!newSale);
  const [searchOpen, setSearchOpen] = useState(false);
  const [status, setStatus] = useState<ShellStatus | null>(null);

  // New sale wants the room: the sidebar folds to icons there and opens again on the way out.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the route decides the default fold
    setOpen(!newSale);
  }, [newSale]);

  // Counts re-asked on every navigation — something was just sold, paid or restocked.
  useEffect(() => {
    let live = true;
    getShellStatusAction()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  const canSell = nav.shopFloor.some((l) => l.key === "new-sale");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === "F2" && canSell) {
        e.preventDefault();
        router.push(NEW_SALE_HREF);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSell, router]);

  return (
    // Same as AppShell: what this shop offers (no WhatsApp for the tyre centre) for every
    // client component below — the server actions check hasWhatsApp again.
    <ShopFeaturesProvider whatsapp={hasWhatsApp(ctx.tenantId)}>
    <SidebarProvider
      open={open}
      onOpenChange={setOpen}
      className="h-dvh overflow-hidden bg-tc-app"
      style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}
    >
      <TyreSidebar nav={nav} status={status} brandName={brand.name} displayName={ctx.displayName} role={ctx.role} />
      <SidebarInset className="flex h-dvh min-w-0 flex-col overflow-hidden bg-tc-app">
        <TyreTopbar
          nav={nav}
          shop={status?.companies[0]?.name ?? brand.name}
          canSell={canSell}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SidebarInset>
      <TyreCommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Toaster position="bottom-right" />
    </SidebarProvider>
    </ShopFeaturesProvider>
  );
}
