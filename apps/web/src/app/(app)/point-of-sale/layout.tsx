import { requireRole, requireModule } from "@/lib/auth/session";

// The Point of Sale module (devices, tills, monthly close) is owner/manager
// territory; the owner can additionally revoke it per user via module access.
export default async function PointOfSaleLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager");
  await requireModule("/point-of-sale");
  return <>{children}</>;
}
