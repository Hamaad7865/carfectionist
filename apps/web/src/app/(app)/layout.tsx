import { AppShell } from "@/components/shell/AppShell";
import { AuthKeepalive } from "@/components/shell/AuthKeepalive";
import { fiscalYears } from "@/lib/supabase/queries/notifications";
import { THEME_INIT_SCRIPT, THEME_INIT_SCRIPT_SYSTEM } from "@/lib/theme";
import type { Metadata } from "next";
import { getSessionContext, requireSession } from "@/lib/auth/session";
import { getShopBrand } from "@/lib/brand-server";
import { brandIcons } from "@/lib/brand";

/** Another shop's tab says its own name, never "Carfection". */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getSessionContext();
  if (!ctx) return {};
  const brand = await getShopBrand(ctx.tenantId);
  if (brand.key !== "shop" && brand.key !== "tyrecentre") return {};
  const icons = brandIcons(brand);
  return {
    title: brand.name,
    description: brand.pageDescription,
    icons: { icon: icons.favicon, apple: icons.apple },
  };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  // Carfectionist's own tenants wear the host's brand; any other shop sees only its own name.
  const brand = await getShopBrand(ctx.tenantId);

  // The bell fetches its own alerts from /api/notifications (see Topbar). It used
  // to be computed here, which cost every page ~1s AND froze the badge — a layout
  // does not re-run on client navigation, so the count was stuck at whatever it
  // said on first load. Owning its own data makes it live and takes the shell off
  // the critical path.

  return (
    <>
      {/* Dark mode, applied before first paint (lib/theme.ts). The tyre centre follows the
          computer's setting until someone picks; Carfectionist stays light until switched. */}
      <script dangerouslySetInnerHTML={{ __html: brand.key === "tyrecentre" ? THEME_INIT_SCRIPT_SYSTEM : THEME_INIT_SCRIPT }} />
      <AuthKeepalive />
      <AppShell ctx={ctx} brand={brand} fiscalYears={fiscalYears()}>
        {children}
      </AppShell>
    </>
  );
}
