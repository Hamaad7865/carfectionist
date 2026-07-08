"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { SessionContext } from "@/lib/auth/session";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ ctx, children }: { ctx: SessionContext; children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      {/* Desktop sidebar (fixed) */}
      <div className="hidden md:flex md:w-[236px] md:shrink-0">
        <Sidebar role={ctx.role} displayName={ctx.displayName} modules={ctx.modules} />
      </div>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-[rgba(15,23,32,0.45)] backdrop-blur-[1px]" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[264px] max-w-[84%] shadow-[0_20px_60px_-10px_rgba(15,23,32,0.5)]">
            <Sidebar role={ctx.role} displayName={ctx.displayName} modules={ctx.modules} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main
          className="flex-1 overflow-y-auto"
          style={{ background: "radial-gradient(900px 500px at 100% 0%, rgba(43,140,255,.045), transparent 60%)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
