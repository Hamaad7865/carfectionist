import { requireModule } from "@/lib/auth/session";

export default async function ProductsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("/products");
  return <>{children}</>;
}
