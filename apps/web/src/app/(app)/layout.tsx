import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { AuthKeepalive } from "@/components/shell/AuthKeepalive";
import { getNotifications, fiscalYears } from "@/lib/supabase/queries/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();

  // NOT awaited, deliberately. The bell's alerts are the most expensive thing in
  // the shell — they read every unpaid invoice, the enquiries, the reminders and
  // the entire stock position — and awaiting them here held EVERY page behind a
  // badge nobody is waiting for. Hand the promise down instead: the shell renders
  // now and the bell fills itself in when the answer arrives. The .catch keeps a
  // failed read from becoming an unhandled rejection; the bell just stays empty.
  const notifications = getNotifications().catch(() => []);

  return (
    <>
      <AuthKeepalive />
      <AppShell ctx={ctx} notifications={notifications} fiscalYears={fiscalYears()}>
        {children}
      </AppShell>
    </>
  );
}
