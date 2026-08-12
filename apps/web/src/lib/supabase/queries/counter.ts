import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getStockLocations, pickSalesFloor } from "@/lib/supabase/locations";
import { productPhotoUrl } from "@/lib/supabase/storage";
import { rupeesToCents, policyOf, type DiscountPolicy } from "@/lib/money";
// One reading of the owner's rules, shared with the builder — two copies of the coercion
// would be exactly the client/DB divergence this feature exists to prevent.
import { posRulesFrom, type PosRules } from "@/lib/supabase/queries/builder";

export interface CounterProduct {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  priceCents: number;
  vatRate: number;
  /** How much of this may be given away. Every counter line is a catalogue line sending
   *  line_kind null, so the product answers alone — the same fallback the database's own
   *  app.document_discount_limits derives from its product join. */
  discountPolicy: DiscountPolicy;
  barcode: string | null;
  photoUrl: string | null;
  isStocked: boolean;
  shopQty: number;      // on-hand at the selling floor, where counter sales draw from
  warehouseQty: number; // on-hand everywhere else, summed (shown as a restock hint)
}

export async function getCounterRef(): Promise<{ products: CounterProduct[]; customers: { id: string; name: string }[]; vatDefault: number; pricesInclVat: boolean; posRules: PosRules }> {
  const sb = await createClient();
  const [prodData, bsRes, custData, ohData, locRes] = await Promise.all([
    fetchAllRows(() => sb.from("products").select("id, name, kind, category, selling_price, vat_rate, barcode, is_stocked, photo_path, discount_policy").eq("is_active", true).order("category").order("name")),
    sb.from("business_settings").select("vat_rate, prices_vat_exclusive, discount_carwash_pct, default_policy_service, default_policy_goods").limit(1).maybeSingle(),
    fetchAllRows(() => sb.from("customers").select("id, name").order("name")),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
    getStockLocations(sb),
  ]);

  // Counter sales draw from the selling floor; everything NOT on the floor rides
  // along as a restock hint, so a shop shortfall reads differently from a true
  // stock-out. Summing every other location (not just the default) is what makes
  // "none in the warehouse either" honest once a second warehouse exists.
  const shopId = pickSalesFloor(locRes)?.id ?? null;
  const shopByProduct = new Map<string, number>();
  const whByProduct = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ohData as any[]) {
    if (shopId && r.location_id === shopId) shopByProduct.set(r.product_id, (shopByProduct.get(r.product_id) ?? 0) + Number(r.qty_on_hand));
    else whByProduct.set(r.product_id, (whByProduct.get(r.product_id) ?? 0) + Number(r.qty_on_hand));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vatDefault = Number((bsRes.data as any)?.vat_rate ?? 15);
  // The owner's live discount rules. The till clamps with these, not with the old constants,
  // so its ceiling is the one app.document_discount_limits will actually enforce.
  const posRules = posRulesFrom(bsRes.data);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products: CounterProduct[] = (prodData as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    category: p.category ?? null,
    priceCents: rupeesToCents(Number(p.selling_price)),
    vatRate: p.vat_rate == null ? vatDefault : Number(p.vat_rate),
    discountPolicy: policyOf(p.discount_policy, p.kind, posRules.policyDefaults),
    barcode: p.barcode ?? null,
    photoUrl: productPhotoUrl(p.photo_path),
    isStocked: !!p.is_stocked,
    shopQty: shopByProduct.get(p.id) ?? 0,
    warehouseQty: whByProduct.get(p.id) ?? 0,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers = (custData as any[]).map((c) => ({ id: c.id, name: c.name }));
  // The shop quotes VAT-INCLUSIVE shelf prices, so the till must show them that way — the
  // tablet counter already does, and the two screens were quoting different figures.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pricesInclVat = (bsRes.data as any)?.prices_vat_exclusive === false;
  return { products, customers, vatDefault, pricesInclVat, posRules };
}
