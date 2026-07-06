import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";

export interface DocFilters {
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  customer?: string;
}

export interface DocListRow {
  id: string;
  doc_type: string;
  status: string;
  number: string | null;
  issue_date: string | null;
  created_at: string;
  total_incl: string;
  amount_paid: string;
  customerName: string | null;
  methodLabel: string;
}

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank" };

export interface DocList {
  rows: DocListRow[]; // display slice (capped)
  count: number; // total matching, uncapped
  totalCents: number; // grand total over ALL matching, uncapped
}

/** Documents list (quotes + invoices + credit notes), RLS-scoped, filtered. The
 *  displayed rows are capped, but count + totalCents are computed uncapped so the
 *  footer figures are correct beyond the display cap. */
export async function listDocuments(f: DocFilters): Promise<DocList> {
  const sb = await createClient();
  const hasCustomer = !!f.customer?.trim();
  const rel = hasCustomer ? "customers!inner(name)" : "customers(name)";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    if (f.type) q = q.eq("doc_type", f.type);
    if (f.status) q = q.eq("status", f.status);
    if (f.from) q = q.gte("created_at", f.from);
    if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999+04:00`);
    if (hasCustomer) q = q.ilike("customers.name", `%${f.customer!.trim()}%`);
    return q;
  };

  const listQ = applyFilters(
    sb
      .from("documents")
      .select(`id, doc_type, status, number, issue_date, created_at, total_incl, amount_paid, payments(method), ${rel}`)
      .order("created_at", { ascending: false })
      .limit(200),
  );
  // Uncapped footer aggregation — one numeric column, paged past the PostgREST
  // 1000-row cap (+ inner join only when filtering by customer).
  const makeTotQ = () => applyFilters(sb.from("documents").select(hasCustomer ? "total_incl, customers!inner(name)" : "total_incl"));

  const [listRes, totArr] = await Promise.all([listQ, fetchAllRows(makeTotQ)]);
  if (listRes.error) throw new Error(listRes.error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((listRes.data ?? []) as any[]).map((d) => {
    const methods: string[] = Array.from(
      new Set(((d.payments ?? []) as { method: string; amount?: number }[]).map((p) => p.method)),
    );
    const methodLabel = methods.length === 0 ? "—" : methods.length > 1 ? "Split" : (METHOD_LABEL[methods[0]] ?? methods[0]);
    return {
      id: d.id,
      doc_type: d.doc_type,
      status: d.status,
      number: d.number,
      issue_date: d.issue_date,
      created_at: d.created_at,
      total_incl: d.total_incl,
      amount_paid: d.amount_paid,
      customerName: d.customers?.name ?? null,
      methodLabel,
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalCents = (totArr as any[]).reduce((s, d) => s + Math.round(Number(d.total_incl) * 100), 0);
  return { rows, count: totArr.length, totalCents };
}
