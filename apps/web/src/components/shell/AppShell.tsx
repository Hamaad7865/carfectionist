import type { SessionContext } from "@/lib/auth/session";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ ctx, children }: { ctx: SessionContext; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      <Sidebar role={ctx.role} displayName={ctx.displayName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
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
