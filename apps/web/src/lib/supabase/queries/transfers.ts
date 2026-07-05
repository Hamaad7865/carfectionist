import { createClient } from "@/lib/supabase/server";

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
  locations: { id: string; name: string }[];
  products: { id: string; name: string; unit: string; store: number; floor: number }[];
}

export async function getTransfers(): Promise<{ transfers: Transfer[]; ref: TransfersRef }> {
  const sb = await createClient();
  const [txRes, locRes, prodRes, ohRes] = await Promise.all([
    sb
      .from("stock_transfers")
      .select("id, status, created_at, from_location_id, to_location_id, note, lines:stock_transfer_lines(id, product_id, qty_dispatched, qty_received, products(name, unit))")
      .order("created_at", { ascending: false })
      .limit(30),
    sb.from("stock_locations").select("id, name, is_default").order("name"),
    sb.from("products").select("id, name, unit").eq("is_stocked", true).eq("is_active", true).order("name"),
    sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const locs = (locRes.data ?? []) as any[];
  const locName = (id: string) => locs.find((l) => l.id === id)?.name ?? "—";
  const storeId = locs.find((l) => /store/i.test(l.name) || l.is_default)?.id;
  const floorId = locs.find((l) => /floor/i.test(l.name))?.id;
  const oh = (ohRes.data ?? []) as any[];
  const at = (pid: string, lid: string | undefined) =>
    lid ? oh.filter((r) => r.product_id === pid && r.location_id === lid).reduce((s, r) => s + Number(r.qty_on_hand), 0) : 0;

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
    locations: locs.map((l) => ({ id: l.id, name: l.name })),
    products: ((prodRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      store: at(p.id, storeId),
      floor: at(p.id, floorId),
    })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { transfers, ref };
}
