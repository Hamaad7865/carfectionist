import { requireRole, requireModule } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager");
  await requireModule("/settings");
  return <>{children}</>;
}
