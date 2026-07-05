import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface InventoryRow {
  id: string;
  name: string;
  kind: string;
  unit: string;
  costCents: number;
  sellCents: number;
  marginPct: number;
  isStocked: boolean;
  store: number | null;
  floor: number | null;
  onHand: number | null;
  low: boolean;
}

export async function getInventory(): Promise<InventoryRow[]> {
  const sb = await createClient();
  const [prodRes, ohRes, locRes] = await Promise.all([
    sb.from("products").select("id, name, kind, unit, selling_price, cost_price, low_stock_threshold, is_stocked").eq("is_active", true).order("kind").order("name"),
    sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"),
    sb.from("stock_locations").select("id, name, is_default"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locs = (locRes.data ?? []) as any[];
  const storeId = locs.find((l) => /store/i.test(l.name) || l.is_default)?.id;
  const floorId = locs.find((l) => /floor/i.test(l.name))?.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oh = (ohRes.data ?? []) as any[];
  const at = (pid: string, lid: string | undefined) =>
    lid ? oh.filter((r) => r.product_id === pid && r.location_id === lid).reduce((s, r) => s + Number(r.qty_on_hand), 0) : 0;
  const total = (pid: string) => oh.filter((r) => r.product_id === pid).reduce((s, r) => s + Number(r.qty_on_hand), 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((prodRes.data ?? []) as any[]).map((p) => {
    const sell = rupeesToCents(Number(p.selling_price));
    const cost = rupeesToCents(Number(p.cost_price));
    const onHand = p.is_stocked ? total(p.id) : null;
    const threshold = p.low_stock_threshold != null ? Number(p.low_stock_threshold) : null;
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      unit: p.unit,
      costCents: cost,
      sellCents: sell,
      marginPct: sell > 0 ? Math.round(((sell - cost) / sell) * 100) : 0,
      isStocked: p.is_stocked,
      store: p.is_stocked ? at(p.id, storeId) : null,
      floor: p.is_stocked ? at(p.id, floorId) : null,
      onHand,
      low: p.is_stocked && threshold != null && onHand != null && onHand < threshold,
    };
  });
}
