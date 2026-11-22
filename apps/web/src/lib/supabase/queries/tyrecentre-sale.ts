import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getCounterRef, type CounterProduct } from "@/lib/supabase/queries/counter";
import type { PosRules } from "@/lib/supabase/queries/builder";

export interface SaleVehicle {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
}

export interface SaleCustomer {
  id: string;
  name: string;
  phone: string | null;
  vehicles: SaleVehicle[];
}

export interface SaleCompany {
  id: string;
  name: string;
  vatRegistered: boolean;
  vatRate: number;
  /** The shop's main company — sells every product that names no company. */
  isDefault: boolean;
}

export interface TyreSaleRef {
  products: CounterProduct[];
  customers: SaleCustomer[];
  pricesInclVat: boolean;
  posRules: PosRules;
  /** The active issuing companies, in sort order (the order their invoices are issued in). */
  companies: SaleCompany[];
  /** Units sold per product over the last 90 days — "Sort · Best seller". */
  soldQty: Record<string, number>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** Everything the tyre-centre New sale screen needs on first paint. The catalogue and the
 *  owner's discount rules come from the counter's own loader, so the two tills can't drift. */
export async function getTyreSaleRef(): Promise<TyreSaleRef> {
  const sb = await createClient();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [ref, custs, cars, ents, sold] = await Promise.all([
    getCounterRef(),
    fetchAllRows<Row>(() => sb.from("customers").select("id, name, phone").order("name")),
    fetchAllRows<Row>(() => sb.from("vehicles").select("id, customer_id, plate, make, model").order("plate")),
    sb.from("legal_entities").select("id, legal_name, trading_name, vat_registered, vat_rate, is_default").eq("is_active", true).order("sort_order").order("id"),
    fetchAllRows<Row>(() =>
      sb
        .from("document_lines")
        .select("id, product_id, qty, documents!inner(doc_type, status, issued_at)")
        .not("product_id", "is", null)
        .eq("documents.doc_type", "invoice")
        .in("documents.status", ["issued", "partly_paid", "paid"])
        .gte("documents.issued_at", since),
    ).catch(() => [] as Row[]),
  ]);

  const byCustomer = new Map<string, SaleVehicle[]>();
  for (const v of cars) {
    const list = byCustomer.get(v.customer_id) ?? [];
    list.push({ id: v.id, plate: v.plate, make: v.make ?? null, model: v.model ?? null });
    byCustomer.set(v.customer_id, list);
  }
  const soldQty: Record<string, number> = {};
  for (const l of sold) soldQty[l.product_id] = (soldQty[l.product_id] ?? 0) + Number(l.qty);

  return {
    products: ref.products,
    pricesInclVat: ref.pricesInclVat,
    posRules: ref.posRules,
    customers: custs.map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null, vehicles: byCustomer.get(c.id) ?? [] })),
    companies: ((ents.data ?? []) as Row[]).map((e) => ({
      id: e.id,
      name: e.trading_name || e.legal_name,
      vatRegistered: e.vat_registered !== false,
      vatRate: Number(e.vat_rate ?? 15),
      isDefault: e.is_default === true,
    })),
    soldQty,
  };
}
