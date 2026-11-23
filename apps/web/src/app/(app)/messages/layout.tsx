import { requireShopModule } from "@/lib/auth/session";

/** A tyre centre has no Messages module: its URL goes back to the dashboard. */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  await requireShopModule("/messages");
  return <>{children}</>;
}
