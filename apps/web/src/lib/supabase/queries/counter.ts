import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface CounterProduct {
  id: string;
  name: string;
  kind: string;
  priceCents: number;
  vatRate: number;
  barcode: string | null;
}

export async function getCounterRef(): Promise<{ products: CounterProduct[]; vatDefault: number }> {
  const sb = await createClient();
  const [prodRes, bsRes] = await Promise.all([
    sb.from("products").select("id, name, kind, selling_price, vat_rate, barcode").eq("is_active", true).order("kind").order("name"),
    sb.from("business_settings").select("vat_rate").limit(1).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vatDefault = Number((bsRes.data as any)?.vat_rate ?? 15);
  const products: CounterProduct[] = // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((prodRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      priceCents: rupeesToCents(Number(p.selling_price)),
      vatRate: p.vat_rate == null ? vatDefault : Number(p.vat_rate),
      barcode: p.barcode ?? null,
    }));
  return { products, vatDefault };
}
