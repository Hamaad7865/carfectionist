import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
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
  warehouse: number | null;
  shop: number | null;
  low: boolean;
}

export async function getInventory(includeArchived = false): Promise<InventoryRow[]> {
  const sb = await createClient();
  const makeProdQ = () => {
    let q = sb
      .from("products")
      .select("id, name, sku, description, kind, category, unit, barcode, selling_price, cost_price, vat_rate, low_stock_threshold, is_stocked, is_active");
    if (!includeArchived) q = q.eq("is_active", true);
    return q.order("category").order("name");
  };

  const [prodData, ohData, locRes] = await Promise.all([
    fetchAllRows(makeProdQ), // paged past the 1000-row cap
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
    sb.from("stock_locations").select("id, name, is_default"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locs = (locRes.data ?? []) as any[];
  // Warehouse = the tenant's default location; Shop = the other. Name-independent
  // so it survives location renames.
  const warehouseId = locs.find((l) => l.is_default)?.id ?? locs[0]?.id;
  const shopId = locs.find((l) => l.id !== warehouseId)?.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oh = ohData as any[];
  const at = (pid: string, lid: string | undefined) =>
    lid ? oh.filter((r) => r.product_id === pid && r.location_id === lid).reduce((s, r) => s + Number(r.qty_on_hand), 0) : 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prodData as any[]).map((p) => {
    const sellingPrice = Number(p.selling_price);
    const costPrice = Number(p.cost_price);
    const sell = rupeesToCents(sellingPrice);
    const cost = rupeesToCents(costPrice);
    const shop = p.is_stocked ? at(p.id, shopId) : null;
    const threshold = p.low_stock_threshold != null ? Number(p.low_stock_threshold) : null;
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
      warehouse: p.is_stocked ? at(p.id, warehouseId) : null,
      shop,
      // "on hand" = the shop quantity; low-stock alerts track the shop.
      low: p.is_stocked && threshold != null && shop != null && shop < threshold,
    };
  });
}
