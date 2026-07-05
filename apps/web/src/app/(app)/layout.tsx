import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { AuthKeepalive } from "@/components/shell/AuthKeepalive";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  return (
    <>
      <AuthKeepalive />
      <AppShell ctx={ctx}>{children}</AppShell>
    </>
  );
}
