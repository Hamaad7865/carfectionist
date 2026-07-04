import type { SessionContext } from "@/lib/auth/session";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({
  ctx,
  children,
}: {
  ctx: SessionContext;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar role={ctx.role} displayName={ctx.displayName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar tradingName="Carfectionist" />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
