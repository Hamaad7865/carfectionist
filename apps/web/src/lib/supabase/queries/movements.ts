import { createClient } from "@/lib/supabase/server";

export interface MovementRow {
  id: string;
  productName: string;
  unit: string;
  locationName: string;
  qty: number; // signed
  refType: string;
  note: string | null;
  movedAt: string;
  by: string | null;
}
export interface InventoryOpsData {
  movements: MovementRow[];
  products: { id: string; name: string; unit: string }[];
  locations: { id: string; name: string }[];
}

export async function getInventoryOps(): Promise<InventoryOpsData> {
  const sb = await createClient();
  const [mvRes, prodRes, locRes] = await Promise.all([
    sb
      .from("stock_movements")
      .select("id, qty, ref_type, note, moved_at, products(name, unit), stock_locations(name), app_users(display_name)")
      .order("moved_at", { ascending: false })
      .limit(120),
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
    sb.from("stock_locations").select("id, name").order("name"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const movements: MovementRow[] = ((mvRes.data ?? []) as any[]).map((m) => ({
    id: m.id,
    productName: m.products?.name ?? "—",
    unit: m.products?.unit ?? "",
    locationName: m.stock_locations?.name ?? "—",
    qty: Number(m.qty),
    refType: m.ref_type,
    note: m.note,
    movedAt: m.moved_at,
    by: m.app_users?.display_name ?? null,
  }));
  return {
    movements,
    products: ((prodRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, unit: p.unit })),
    locations: ((locRes.data ?? []) as any[]).map((l) => ({ id: l.id, name: l.name })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
