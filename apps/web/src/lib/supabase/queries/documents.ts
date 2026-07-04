import { createClient } from "@/lib/supabase/server";

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

/** Documents list (quotes + invoices + credit notes), RLS-scoped, filtered. */
export async function listDocuments(f: DocFilters): Promise<DocListRow[]> {
  const sb = await createClient();
  const hasCustomer = !!f.customer?.trim();
  const rel = hasCustomer ? "customers!inner(name)" : "customers(name)";

  let q = sb
    .from("documents")
    .select(`id, doc_type, status, number, issue_date, created_at, total_incl, amount_paid, payments(method), ${rel}`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (f.type) q = q.eq("doc_type", f.type);
  if (f.status) q = q.eq("status", f.status);
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59`);
  if (hasCustomer) q = q.ilike("customers.name", `%${f.customer!.trim()}%`);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((d: any) => {
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
}
