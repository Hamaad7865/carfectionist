import { requireRole } from "@/lib/auth/session";

// Owner-only: the full who-did-what history exposes everyone's actions.
export default async function ActivityLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner");
  return <>{children}</>;
}
