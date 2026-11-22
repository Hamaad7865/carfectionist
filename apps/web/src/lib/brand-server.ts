import { cache } from "react";
import { headers } from "next/headers";
import { brandForHost, brandForShop, CARFECTIONIST_TENANTS, type BrandInfo } from "./brand";
import { createClient } from "@/lib/supabase/server";

/** The brand for the current request (server components and layouts only). */
export async function getBrand(): Promise<BrandInfo> {
  const h = await headers();
  return brandForHost(h.get("x-forwarded-host") ?? h.get("host"));
}

/** The brand inside the app for the signed-in shop (layouts and metadata share one lookup). */
export const getShopBrand = cache(async (tenantId: string): Promise<BrandInfo> => {
  let shopName: string | null = null;
  if (!CARFECTIONIST_TENANTS.includes(tenantId)) {
    const sb = await createClient();
    const { data } = await sb.from("business_settings").select("trading_name, legal_name").eq("id", tenantId).maybeSingle();
    shopName = data?.trading_name || data?.legal_name || null;
  }
  return brandForShop(await getBrand(), tenantId, shopName);
});
