import { requireRole, requireModule } from "@/lib/auth/session";

// Same floor as Sales Journal and Reports: this is who owes the shop and
// when they paid. Nav hiding + this gate + RLS = defense in depth.
export default async function ReconciliationLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager", "accountant");
  await requireModule("/reconciliation");
  return <>{children}</>;
}
