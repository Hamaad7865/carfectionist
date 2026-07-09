import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { rupeesToCents } from "@/lib/money";

export interface CounterProduct {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  priceCents: number;
  vatRate: number;
  barcode: string | null;
  isStocked: boolean;
  stockQty: number; // total on-hand across locations (0 when not tracked)
}

export async function getCounterRef(): Promise<{ products: CounterProduct[]; customers: { id: string; name: string }[]; vatDefault: number }> {
  const sb = await createClient();
  const [prodData, bsRes, custData, ohData] = await Promise.all([
    fetchAllRows(() => sb.from("products").select("id, name, kind, category, selling_price, vat_rate, barcode, is_stocked").eq("is_active", true).order("category").order("name")),
    sb.from("business_settings").select("vat_rate").limit(1).maybeSingle(),
    fetchAllRows(() => sb.from("customers").select("id, name").order("name")),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, qty_on_hand"), "product_id"),
  ]);

  // Total on-hand per product across every location (a walk-in can be filled
  // from anywhere we hold stock).
  const qtyByProduct = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ohData as any[]) qtyByProduct.set(r.product_id, (qtyByProduct.get(r.product_id) ?? 0) + Number(r.qty_on_hand));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vatDefault = Number((bsRes.data as any)?.vat_rate ?? 15);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products: CounterProduct[] = (prodData as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    category: p.category ?? null,
    priceCents: rupeesToCents(Number(p.selling_price)),
    vatRate: p.vat_rate == null ? vatDefault : Number(p.vat_rate),
    barcode: p.barcode ?? null,
    isStocked: !!p.is_stocked,
    stockQty: qtyByProduct.get(p.id) ?? 0,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers = (custData as any[]).map((c) => ({ id: c.id, name: c.name }));
  return { products, customers, vatDefault };
}
