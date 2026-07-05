import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface ExpenseRow {
  id: string;
  date: string;
  category: string;
  description: string | null;
  amountCents: number;
  vatCents: number;
  status: string;
}
export interface PORow {
  id: string;
  reference: string | null;
  supplier: string | null;
  date: string | null;
  status: string;
}

export interface PurchasesData {
  expenses: ExpenseRow[];
  expenseTotalCents: number;
  pos: PORow[];
}

export async function getPurchases(): Promise<PurchasesData> {
  const sb = await createClient();
  const [expRes, poRes] = await Promise.all([
    sb.from("expenses").select("id, category, description, amount, vat_amount, status, expense_date").order("expense_date", { ascending: false }).limit(100),
    sb.from("purchase_orders").select("id, reference, status, order_date, suppliers(name)").order("created_at", { ascending: false }).limit(50),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expenses: ExpenseRow[] = ((expRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    date: e.expense_date,
    category: e.category,
    description: e.description,
    amountCents: rupeesToCents(Number(e.amount)),
    vatCents: rupeesToCents(Number(e.vat_amount)),
    status: e.status,
  }));

  return {
    expenses,
    expenseTotalCents: expenses.reduce((s, e) => s + e.amountCents + e.vatCents, 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pos: ((poRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      reference: p.reference,
      supplier: p.suppliers?.name ?? null,
      date: p.order_date,
      status: p.status,
    })),
  };
}

// ── Purchase orders (create + receive) ───────────────────────────────────────
export interface POLine {
  id: string;
  productId: string;
  name: string;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCostCents: number;
}
export interface PurchaseOrder {
  id: string;
  reference: string | null;
  supplier: string | null;
  date: string | null;
  status: string;
  totalCents: number;
  lines: POLine[];
}
export interface POData {
  pos: PurchaseOrder[];
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; unit: string; costCents: number }[];
  locations: { id: string; name: string }[];
}

export async function getPurchaseOrders(): Promise<POData> {
  const sb = await createClient();
  const [poRes, supRes, prodRes, locRes] = await Promise.all([
    sb
      .from("purchase_orders")
      .select("id, reference, status, order_date, suppliers(name), lines:purchase_order_lines(id, product_id, qty_ordered, qty_received, unit_cost, products(name, unit))")
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("suppliers").select("id, name").order("name"),
    sb.from("products").select("id, name, unit, cost_price").eq("is_stocked", true).eq("is_active", true).order("name"),
    sb.from("stock_locations").select("id, name, is_default").order("name"),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const pos: PurchaseOrder[] = ((poRes.data ?? []) as any[]).map((p) => {
    const lines: POLine[] = (p.lines ?? []).map((l: any) => ({
      id: l.id,
      productId: l.product_id,
      name: l.products?.name ?? "—",
      unit: l.products?.unit ?? "",
      qtyOrdered: Number(l.qty_ordered),
      qtyReceived: Number(l.qty_received ?? 0),
      unitCostCents: rupeesToCents(Number(l.unit_cost)),
    }));
    return {
      id: p.id,
      reference: p.reference,
      supplier: p.suppliers?.name ?? null,
      date: p.order_date,
      status: p.status,
      totalCents: lines.reduce((s, l) => s + Math.round(l.unitCostCents * l.qtyOrdered), 0),
      lines,
    };
  });

  const locs = (locRes.data ?? []) as any[];
  return {
    pos,
    suppliers: ((supRes.data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name })),
    products: ((prodRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, unit: p.unit, costCents: rupeesToCents(Number(p.cost_price)) })),
    locations: locs.map((l) => ({ id: l.id, name: l.name })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
