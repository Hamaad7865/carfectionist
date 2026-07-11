import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The Shop (walk-in front) location id — the single resolver every counter-side
 * stock write shares, so all clients move the SAME on-hand. Prefer the location
 * named 'Shop', else the first non-default location; null lets the RPC coalesce
 * to the tenant default (Warehouse) as a last resort. Mirrors the Android
 * resolver in PosApi.fetchShopLocationId().
 */
export async function resolveShopLocationId(sb: SupabaseClient<Database>): Promise<string | null> {
  const { data: locs } = await sb.from("stock_locations").select("id, name, is_default");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locArr = (locs ?? []) as any[];
  return (locArr.find((l) => l.name === "Shop") ?? locArr.find((l) => !l.is_default))?.id ?? null;
}
