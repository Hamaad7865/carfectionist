import { createClient } from "@/lib/supabase/server";
import { getStockLocations } from "@/lib/supabase/locations";

export interface TransferLine {
  id: string;
  productId: string;
  name: string;
  unit: string;
  qtyDispatched: number;
  qtyReceived: number | null;
}
export interface Transfer {
  id: string;
  status: "draft" | "dispatched" | "received";
  createdAt: string;
  fromName: string;
  toName: string;
  note: string | null;
  lines: TransferLine[];
}
export interface TransfersRef {
  /** Active locations only — you cannot send stock to a retired one. */
  locations: { id: string; name: string; isDefault: boolean; isSalesFloor: boolean }[];
  /** stock[locationId] — keyed, so "available to send" follows the location you
   *  actually picked rather than a warehouse-or-shop guess. */
  products: { id: string; name: string; unit: string; stock: Record<string, number> }[];
}

export async function getTransfers(): Promise<{ transfers: Transfer[]; ref: TransfersRef }> {
  const sb = await createClient();
  const [txRes, locRes, prodRes, ohRes] = await Promise.all([
    sb
      .from("stock_transfers")
      .select("id, status, created_at, from_location_id, to_location_id, note, lines:stock_transfer_lines(id, product_id, qty_dispatched, qty_received, products(name, unit))")
      .order("created_at", { ascending: false })
      .limit(30),
    getStockLocations(sb), // ALL of them — see locName
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
    sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // History can point at a retired location, so names resolve against every
  // location; only the live ones are offered for a NEW transfer.
  const locName = (id: string) => locRes.find((l) => l.id === id)?.name ?? "—";

  const oh = (ohRes.data ?? []) as any[];
  const byProduct = new Map<string, Record<string, number>>();
  for (const r of oh) {
    const at = byProduct.get(r.product_id) ?? {};
    at[r.location_id] = (at[r.location_id] ?? 0) + Number(r.qty_on_hand);
    byProduct.set(r.product_id, at);
  }

  const transfers: Transfer[] = ((txRes.data ?? []) as any[]).map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.created_at,
    fromName: locName(t.from_location_id),
    toName: locName(t.to_location_id),
    note: t.note,
    lines: (t.lines ?? []).map((l: any) => ({
      id: l.id,
      productId: l.product_id,
      name: l.products?.name ?? "—",
      unit: l.products?.unit ?? "",
      qtyDispatched: Number(l.qty_dispatched),
      qtyReceived: l.qty_received == null ? null : Number(l.qty_received),
    })),
  }));

  const ref: TransfersRef = {
    locations: locRes.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault, isSalesFloor: l.isSalesFloor })),
    products: ((prodRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      stock: byProduct.get(p.id) ?? {},
    })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { transfers, ref };
}
