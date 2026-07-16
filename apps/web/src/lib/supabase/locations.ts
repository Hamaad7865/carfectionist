import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// The one place the app decides what a stock location IS.
//
// This used to be answered four different ways. Half the codebase called the
// selling floor "the location that isn't the default" — a coin flip the moment a
// third location exists, because nothing ordered the rows. The other half matched
// the literal name 'Shop', which meant renaming the Shop would silently redirect
// the till's stock. Neither is a fact about the business.
//
// is_sales_floor is that fact, so it is asked first. The two fallbacks behind it
// are belt-and-braces for a tenant whose flag was never set (a fresh seed, say):
// they reproduce exactly what the old code did, so behaviour cannot regress.

export interface StockLocation {
  id: string;
  name: string;
  /** Where stock lands when nobody names a location — the bulk store. */
  isDefault: boolean;
  /** Where the till debits — the customer-facing floor. */
  isSalesFloor: boolean;
  /** Off = retired. Always empty: a location can only be switched off at zero stock. */
  isActive: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toStockLocation(row: any): StockLocation {
  return {
    id: row.id,
    name: row.name,
    isDefault: !!row.is_default,
    isSalesFloor: !!row.is_sales_floor,
    isActive: row.is_active !== false,
  };
}

/** The floor the till sells from. */
export function pickSalesFloor(locations: StockLocation[]): StockLocation | null {
  return (
    locations.find((l) => l.isSalesFloor) ??
    locations.find((l) => l.name === "Shop") ??
    locations.find((l) => !l.isDefault) ??
    null
  );
}

/** The bulk store — where an invoice deducts from unless told otherwise. */
export function pickDefault(locations: StockLocation[]): StockLocation | null {
  return locations.find((l) => l.isDefault) ?? locations[0] ?? null;
}

const COLUMNS = "id, name, is_default, is_sales_floor, is_active";

/** Every location: default first, then the sales floor, then alphabetical — a
 *  stable order, so catalogue columns and pickers don't reshuffle between page
 *  loads the way an unordered query would. */
export async function getStockLocations(sb: SupabaseClient<Database>, activeOnly = false): Promise<StockLocation[]> {
  let q = (sb as any).from("stock_locations").select(COLUMNS);
  if (activeOnly) q = q.eq("is_active", true);
  const { data } = await q
    .order("is_default", { ascending: false })
    .order("is_sales_floor", { ascending: false })
    .order("name");
  return ((data ?? []) as any[]).map(toStockLocation);
}

/**
 * The selling-floor id every counter-side stock write shares, so all clients
 * move the SAME on-hand. Null lets the RPC coalesce to the tenant default as a
 * last resort. Mirrors the Android resolver in PosApi.fetchShopLocationId().
 */
export async function resolveShopLocationId(sb: SupabaseClient<Database>): Promise<string | null> {
  return pickSalesFloor(await getStockLocations(sb))?.id ?? null;
}
