import { requireRole, requireModule } from "@/lib/auth/session";

// Accounting is owner/manager/accountant only (RLS floor), plus the owner can
// remove it from a specific user via module access. Nav hiding + this gate +
// RLS = defense in depth.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager", "accountant");
  await requireModule("/reports");
  return <>{children}</>;
}
