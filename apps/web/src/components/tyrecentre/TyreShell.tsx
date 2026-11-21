"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import type { SessionContext } from "@/lib/auth/session";
import type { BrandInfo } from "@/lib/brand";
import { isNewSalePath, NEW_SALE_HREF, tyreCentreNav } from "@/lib/tyrecentre/nav";
import { getShellStatusAction, type ShellStatus } from "@/features/tyrecentre/shell-actions";
import { TyreSidebar } from "./TyreSidebar";
import { TyreCommandSearch } from "./TyreCommandSearch";
import { TyreMark } from "./TyreMark";

/** The tyre-centre back office frame: shadcn sidebar + content. No topbar — each screen
 *  carries its own header (DESIGN-SPEC §6). Carfectionist keeps AppShell. */
export function TyreShell({ ctx, brand, children }: { ctx: SessionContext; brand: BrandInfo; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useMemo(() => tyreCentreNav(ctx.role, ctx.modules), [ctx.role, ctx.modules]);
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
    <SidebarProvider
      open={open}
      onOpenChange={setOpen}
      className="h-dvh overflow-hidden bg-tc-app"
      style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}
    >
      <TyreSidebar nav={nav} status={status} brandName={brand.name} displayName={ctx.displayName} role={ctx.role} />
      <SidebarInset className="min-w-0 overflow-y-auto bg-tc-app">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tc-line bg-tc-sidebar px-3 md:hidden">
          <SidebarTrigger className="size-9" />
          <TyreMark size={28} radius={7} />
          <span className="flex-1 truncate text-[14px] font-bold text-tc-ink">{status?.companies[0]?.name ?? brand.name}</span>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="grid size-9 place-items-center rounded-full text-tc-body hover:bg-tc-sidebar-active"
          >
            <Search className="size-[18px]" />
          </button>
        </header>
        {children}
      </SidebarInset>
      <TyreCommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <Toaster position="bottom-right" />
    </SidebarProvider>
  );
}
