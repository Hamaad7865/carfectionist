import { requireRole } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager");
  return <>{children}</>;
}
