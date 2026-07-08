import { requireModule } from "@/lib/auth/session";

export default async function AppointmentsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("/appointments");
  return <>{children}</>;
}
