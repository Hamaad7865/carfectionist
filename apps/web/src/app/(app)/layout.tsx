import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { AuthKeepalive } from "@/components/shell/AuthKeepalive";
import { fiscalYears } from "@/lib/supabase/queries/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();

  // The bell fetches its own alerts from /api/notifications (see Topbar). It used
  // to be computed here, which cost every page ~1s AND froze the badge — a layout
  // does not re-run on client navigation, so the count was stuck at whatever it
  // said on first load. Owning its own data makes it live and takes the shell off
  // the critical path.

  return (
    <>
      <AuthKeepalive />
      <AppShell ctx={ctx} fiscalYears={fiscalYears()}>
        {children}
      </AppShell>
    </>
  );
}
