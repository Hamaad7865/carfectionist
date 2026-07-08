import { requireModule } from "@/lib/auth/session";

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  await requireModule("/sales");
  return <>{children}</>;
}
