import { requireRole } from "@/lib/auth/session";

export default async function EnquiriesLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner", "manager");
  return <>{children}</>;
}
