import { requireRole, requireModule } from "@/lib/auth/session";

export default async function EnquiriesLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager");
  await requireModule("/enquiries");
  return <>{children}</>;
}
