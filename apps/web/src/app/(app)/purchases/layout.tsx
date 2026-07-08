import { requireRole, requireModule } from "@/lib/auth/session";

export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager", "accountant");
  await requireModule("/purchases");
  return <>{children}</>;
}
