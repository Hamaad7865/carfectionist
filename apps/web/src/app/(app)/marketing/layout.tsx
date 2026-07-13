import { requireRole } from "@/lib/auth/session";

// Marketing (WhatsApp campaigns) is owner-only — Anesh/Diksha. Managers and
// below never see the module; RLS on the tables is the real boundary.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireRole("owner");
  return <>{children}</>;
}
