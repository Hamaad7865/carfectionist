import { requireModule } from "@/lib/auth/session";

export default async function ContactsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("/contacts");
  return <>{children}</>;
}
