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
  /** The invoice / credit note behind a sale or restock, so the row can link to it. */
  docId: string | null;
  docNumber: string | null;
}
export interface InventoryOpsData {
  movements: MovementRow[];
  products: { id: string; name: string; unit: string }[];
  /** Active only — a retired location is empty by construction, so there's nothing to adjust there. */
  locations: StockLocation[];
  /** Live counts, so adjusting doesn't mean flipping back to the Catalogue to see the shelf. */
  onHand: OnHand;
}

const MOVEMENT_COLS =
  "id, product_id, location_id, qty, ref_type, ref_id, note, moved_at, products(name, unit), stock_locations(name), app_users(display_name)";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toOnHand(rows: any[]): OnHand {
  const onHand: OnHand = {};
  for (const r of rows) {
    const at = (onHand[r.product_id] ??= {});
    at[r.location_id] = roundQty((at[r.location_id] ?? 0) + Number(r.qty_on_hand));
  }
  return onHand;
}

/** Movement ref types whose ref_id is a documents row (one per bill, shared by its lines). */
const DOC_REF_TYPES = new Set(["invoice", "credit_note"]);

type Sb = Awaited<ReturnType<typeof createClient>>;

/** document id → its number (INV-…, CN-…). No FK from stock_movements, so a second read. */
async function docNumbers(sb: Sb, rows: any[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.filter((m) => DOC_REF_TYPES.has(m.ref_type) && m.ref_id).map((m) => m.ref_id as string))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  // Chunked so a long product history never builds an over-long URL.
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await sb.from("documents").select("id, number").in("id", ids.slice(i, i + 150));
    for (const d of (data ?? []) as any[]) if (d.number) out.set(d.id, d.number);
  }
  return out;
}

function toMovementRows(rows: any[], onHand: OnHand, numbers: Map<string, string>): MovementRow[] {
  return balancesAfter(
    rows.map((m) => ({
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
      docId: DOC_REF_TYPES.has(m.ref_type) ? (m.ref_id ?? null) : null,
      docNumber: DOC_REF_TYPES.has(m.ref_type) && m.ref_id ? (numbers.get(m.ref_id) ?? null) : null,
    })),
    onHand,
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Cap on one product's history — years of a busy line, still one quick query. */
export const PRODUCT_HISTORY_LIMIT = 1000;

/**
 * Every movement of one product, newest first, with the stock left after each.
 * The Inventory tab's main list holds only the latest movements shop-wide, so a
 * product's older history needs its own read.
 */
export async function getProductMovements(productId: string): Promise<{ movements: MovementRow[]; truncated: boolean }> {
  const sb = await createClient();
  const [mvRes, ohRes] = await Promise.all([
    sb
      .from("stock_movements")
      .select(MOVEMENT_COLS)
      .eq("product_id", productId)
      .order("moved_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PRODUCT_HISTORY_LIMIT + 1),
    sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand").eq("product_id", productId),
  ]);
  if (mvRes.error) throw new Error(mvRes.error.message);
  if (ohRes.error) throw new Error(ohRes.error.message);
  const rows = (mvRes.data ?? []) as unknown[];
  const truncated = rows.length > PRODUCT_HISTORY_LIMIT;
  const kept = rows.slice(0, PRODUCT_HISTORY_LIMIT);
  return {
    movements: toMovementRows(kept, toOnHand((ohRes.data ?? []) as unknown[]), await docNumbers(sb, kept)),
    truncated,
  };
}

export async function getInventoryOps(): Promise<InventoryOpsData> {
  const sb = await createClient();
  const [mvRes, prodRes, locations, ohData] = await Promise.all([
    sb
      .from("stock_movements")
      .select(MOVEMENT_COLS)
      .order("moved_at", { ascending: false })
      .order("id", { ascending: false }) // a stock count files many rows in one instant; balances need one fixed order
      .limit(120),
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
    getStockLocations(sb, true),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
  ]);

  const onHand = toOnHand(ohData as unknown[]);
  const mvRows = (mvRes.data ?? []) as unknown[];
  const movements = toMovementRows(mvRows, onHand, await docNumbers(sb, mvRows));
  return {
    movements,
    products: ((prodRes.data ?? []) as { id: string; name: string; unit: string }[]).map((p) => ({ id: p.id, name: p.name, unit: p.unit })),
    locations,
    onHand,
  };
}
