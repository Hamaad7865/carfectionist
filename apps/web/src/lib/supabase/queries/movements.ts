import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getStockLocations, type StockLocation } from "@/lib/supabase/locations";
import { balancesAfter, roundQty, type OnHand } from "@/lib/stock/balance";

export interface MovementRow {
  id: string;
  productId: string;
  locationId: string;
  productName: string;
  unit: string;
  locationName: string;
  qty: number; // signed
  /** On hand at this location right after this movement. */
  balanceAfter: number;
  refType: string;
  note: string | null;
  movedAt: string;
  by: string | null;
}
export interface InventoryOpsData {
  movements: MovementRow[];
  products: { id: string; name: string; unit: string }[];
  /** Active only — a retired location is empty by construction, so there's nothing to adjust there. */
  locations: StockLocation[];
  /** Live counts, so adjusting doesn't mean flipping back to the Catalogue to see the shelf. */
  onHand: OnHand;
}

export async function getInventoryOps(): Promise<InventoryOpsData> {
  const sb = await createClient();
  const [mvRes, prodRes, locations, ohData] = await Promise.all([
    sb
      .from("stock_movements")
      .select("id, product_id, location_id, qty, ref_type, note, moved_at, products(name, unit), stock_locations(name), app_users(display_name)")
      .order("moved_at", { ascending: false })
      .order("id", { ascending: false }) // a stock count files many rows in one instant; balances need one fixed order
      .limit(120),
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
    getStockLocations(sb, true),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const onHand: OnHand = {};
  for (const r of ohData as any[]) {
    const at = (onHand[r.product_id] ??= {});
    at[r.location_id] = roundQty((at[r.location_id] ?? 0) + Number(r.qty_on_hand));
  }

  const movements: MovementRow[] = balancesAfter(
    ((mvRes.data ?? []) as any[]).map((m) => ({
      id: m.id,
      productId: m.product_id,
      locationId: m.location_id,
      productName: m.products?.name ?? "—",
      unit: m.products?.unit ?? "",
      locationName: m.stock_locations?.name ?? "—",
      qty: Number(m.qty),
      refType: m.ref_type,
      note: m.note,
      movedAt: m.moved_at,
      by: m.app_users?.display_name ?? null,
    })),
    onHand,
  );
  return {
    movements,
    products: ((prodRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, unit: p.unit })),
    locations,
    onHand,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
