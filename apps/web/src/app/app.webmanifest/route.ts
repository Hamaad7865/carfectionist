import type { MetadataRoute } from "next";
import { getSessionContext } from "@/lib/auth/session";
import { getBrand, getShopBrand } from "@/lib/brand-server";
import { brandAppName, brandIcons } from "@/lib/brand";

/** Web app manifest — lets Chrome/Edge offer "Install" in the address bar. Served per
 *  session (the root layout links it with crossOrigin="use-credentials") so the tyre centre
 *  installs its own name and the HAZ icon, never Carfectionist's. */
export async function GET() {
  const ctx = await getSessionContext();
  const brand = ctx ? await getShopBrand(ctx.tenantId) : await getBrand();
  const name = brandAppName(brand);
  const manifest: MetadataRoute.Manifest = {
    id: "/",
    name,
    short_name: name,
    description: brand.pageDescription,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: brand.key === "carfectionist" ? "#0E1013" : "#2b8cff",
    theme_color: "#111821",
    icons: [...brandIcons(brand).app],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "private, no-cache",
    },
  });
}
