import { requireRole } from "@/lib/auth/session";

// Accounting is owner/manager/accountant only — a cashier hitting /reports is
// redirected to the dashboard. Nav hiding + this gate + RLS = defense in depth.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager", "accountant");
  return <>{children}</>;
}
