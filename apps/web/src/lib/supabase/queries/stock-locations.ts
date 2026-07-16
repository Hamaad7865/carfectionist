import { createClient } from "@/lib/supabase/server";
import { getStockLocations, type StockLocation } from "@/lib/supabase/locations";

// The Locations settings screen. Each row carries the two facts that decide what
// the owner is allowed to do with it, so the UI can explain a refusal BEFORE he
// clicks rather than surfacing a raise from the database afterwards:
//   • units — a location holding stock cannot be switched off (it would strand it)
//   • hasHistory — a location the ledger points at can never be deleted, only
//     switched off; the FK is RESTRICT, and rightly so.

export interface LocationAdminRow extends StockLocation {
  /** Distinct products held here. */
  products: number;
  /** Total units held here. */
  units: number;
  /** Has any stock ever moved through here, or any transfer named it? */
  hasHistory: boolean;
}

export async function getLocationsAdmin(): Promise<LocationAdminRow[]> {
  const sb = await createClient();
  const [locations, ohRes, mvRes, txRes] = await Promise.all([
    getStockLocations(sb),
    sb.from("stock_on_hand").select("location_id, product_id, qty_on_hand"),
    // Ids only — we need "did anything ever happen here", not the ledger itself.
    sb.from("stock_movements").select("location_id"),
    sb.from("stock_transfers").select("from_location_id, to_location_id"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const held = new Map<string, { products: number; units: number }>();
  for (const r of (ohRes.data ?? []) as any[]) {
    const cur = held.get(r.location_id) ?? { products: 0, units: 0 };
    const qty = Number(r.qty_on_hand);
    // A zero row is a product that has been here and left — not stock on hand.
    if (qty !== 0) cur.products += 1;
    cur.units += qty;
    held.set(r.location_id, cur);
  }

  const touched = new Set<string>();
  for (const m of (mvRes.data ?? []) as any[]) touched.add(m.location_id);
  for (const t of (txRes.data ?? []) as any[]) {
    touched.add(t.from_location_id);
    touched.add(t.to_location_id);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return locations.map((l) => ({
    ...l,
    products: held.get(l.id)?.products ?? 0,
    units: held.get(l.id)?.units ?? 0,
    hasHistory: touched.has(l.id),
  }));
}
