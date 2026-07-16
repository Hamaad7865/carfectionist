import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getStockLocations, pickSalesFloor, type StockLocation } from "@/lib/supabase/locations";
import { stockState, type StockState } from "@/lib/stock/low";
import { rupeesToCents } from "@/lib/money";

export interface InventoryRow {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  kind: string;
  category: string | null;
  unit: string;
  barcode: string | null;
  costCents: number;
  sellCents: number;
  sellingPrice: number; // raw rupees (2dp)
  costPrice: number; // raw rupees (4dp)
  vatRatePct: number | null; // null = tenant default
  marginPct: number;
  isStocked: boolean;
  threshold: number | null;
  isActive: boolean;
  /** Quantity per location id. Null for anything not stocked (a service).
   *  Keyed rather than a warehouse/shop pair, because the pair could only ever
   *  describe two locations and quietly dropped any third. */
  stock: Record<string, number> | null;
  /** On-hand at the selling floor — what "low" is measured against. */
  floorQty: number | null;
  /** ok | low (in the warehouse, not out front) | out (none anywhere).
   *  Shared with the bell, so the alert's count and this list agree. */
  state: StockState;
  /** Kept as the narrow question the UI usually asks: is this restockable? */
  low: boolean;
}

export interface InventoryData {
  rows: InventoryRow[];
  /** The columns to draw, in a stable order. Active only: a switched-off
   *  location is empty by construction, so it has nothing to show. */
  locations: StockLocation[];
}

export async function getInventory(includeArchived = false): Promise<InventoryData> {
  const sb = await createClient();
  const makeProdQ = () => {
    let q = sb
      .from("products")
      .select("id, name, sku, description, kind, category, unit, barcode, selling_price, cost_price, vat_rate, low_stock_threshold, is_stocked, is_active");
    if (!includeArchived) q = q.eq("is_active", true);
    return q.order("category").order("name");
  };

  const [prodData, ohData, locations] = await Promise.all([
    fetchAllRows(makeProdQ), // paged past the 1000-row cap
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
    getStockLocations(sb, true),
  ]);

  const floorId = pickSalesFloor(locations)?.id ?? null;

  // Index the ledger once: this used to re-scan every on-hand row for every
  // product × location, which is fine at two columns and quadratic at five.
  const byProduct = new Map<string, Record<string, number>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ohData as any[]) {
    const at = byProduct.get(r.product_id) ?? {};
    at[r.location_id] = (at[r.location_id] ?? 0) + Number(r.qty_on_hand);
    byProduct.set(r.product_id, at);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (prodData as any[]).map((p) => {
    const sellingPrice = Number(p.selling_price);
    const costPrice = Number(p.cost_price);
    const sell = rupeesToCents(sellingPrice);
    const cost = rupeesToCents(costPrice);
    const held = byProduct.get(p.id) ?? {};
    const stock = p.is_stocked ? Object.fromEntries(locations.map((l) => [l.id, held[l.id] ?? 0])) : null;
    const floorQty = p.is_stocked && floorId ? (held[floorId] ?? 0) : null;
    const threshold = p.low_stock_threshold != null ? Number(p.low_stock_threshold) : null;
    // Across EVERY location, not just the columns on screen — what decides
    // whether a shortfall is a transfer or a purchase.
    const totalQty = Object.values(held).reduce((s, n) => s + n, 0);
    const state = stockState({ isStocked: p.is_stocked, threshold, floorQty, totalQty });
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      description: p.description,
      kind: p.kind,
      category: p.category ?? null,
      unit: p.unit,
      barcode: p.barcode,
      costCents: cost,
      sellCents: sell,
      sellingPrice,
      costPrice,
      vatRatePct: p.vat_rate == null ? null : Number(p.vat_rate),
      marginPct: sell > 0 ? Math.round(((sell - cost) / sell) * 100) : 0,
      isStocked: p.is_stocked,
      threshold,
      isActive: p.is_active,
      stock,
      floorQty,
      state,
      low: state === "low",
    };
  });

  return { rows, locations };
}
