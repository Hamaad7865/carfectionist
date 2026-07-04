import { requireSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
