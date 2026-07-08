import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { AuthKeepalive } from "@/components/shell/AuthKeepalive";
import { getNotifications, fiscalYears } from "@/lib/supabase/queries/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const notifications = await getNotifications();
  return (
    <>
      <AuthKeepalive />
      <AppShell ctx={ctx} notifications={notifications} fiscalYears={fiscalYears()}>
        {children}
      </AppShell>
    </>
  );
}
