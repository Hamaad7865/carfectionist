import { requireRole, requireModule } from "@/lib/auth/session";

// Same floor as Accounting & Reports: this is the shop's takings, broken down by
// till and by user. Nav hiding + this gate + RLS = defense in depth.
export default async function SalesJournalLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager", "accountant");
  await requireModule("/sales-journal");
  return <>{children}</>;
}
