import { requireModule } from "@/lib/auth/session";

export default async function JobsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("/jobs");
  return <>{children}</>;
}
