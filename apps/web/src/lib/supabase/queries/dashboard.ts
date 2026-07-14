import { createClient } from "@/lib/supabase/server";
import {
  fetchAllRows,
  fetchAllRowsByKeyset,
  fixedIsoUpperBound,
} from "@/lib/supabase/paginate";
import { rupeesToCents } from "@/lib/money";
import { muDate } from "@/lib/mu-date";
import {
  resolveSalesPeriod,
  salesQuerySpec,
  settleSalesPerformance,
  type SalesDocumentRow,
  type SalesPerformanceData,
  type SalesPeriodInput,
} from "@/features/dashboard/sales-performance";

export interface DashboardData {
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
  docCount: number;
  salesPerformance: SalesPerformanceData;
  counts: { services: number; stocked: number; locations: number; team: number };
  byMethod: { method: string; cents: number }[];
  recent: { id: string; number: string | null; docType: string; status: string; totalCents: number; customer: string | null; date: string }[];
  bestServices: { name: string; cents: number; qty: number }[];
}

interface SalesDocumentCursor {
  issuedAt: string;
  id: string;
}

function salesDocumentCursor(row: SalesDocumentRow): SalesDocumentCursor {
  if (!row.issued_at) {
    throw new Error("Sales pagination row is missing issued_at");
  }
  return { issuedAt: row.issued_at, id: row.id };
}

function compareSalesDocumentCursors(
  left: SalesDocumentCursor,
  right: SalesDocumentCursor,
): number {
  const issuedAtOrder = Date.parse(left.issuedAt) - Date.parse(right.issuedAt);
  if (issuedAtOrder !== 0) return issuedAtOrder;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export async function getDashboard(input: SalesPeriodInput = {}): Promise<DashboardData> {
  const sb = await createClient();
  const period = resolveSalesPeriod(input);
  const salesQuery = salesQuerySpec(period);
  const salesCutoffIso = fixedIsoUpperBound(salesQuery.endExclusiveIso);
  const salesPerformancePromise = settleSalesPerformance(
    period,
    fetchAllRowsByKeyset<SalesDocumentRow, SalesDocumentCursor>(
      (after) => {
        let query = sb
          .from("documents")
          .select(salesQuery.columns)
          .in("doc_type", salesQuery.docTypes)
          .in("status", salesQuery.statuses)
          .not("issued_at", "is", null)
          .gte("issued_at", salesQuery.startIso)
          .lt("issued_at", salesCutoffIso)
          .order("issued_at", { ascending: true })
          .order("id", { ascending: true });

        if (after) {
          query = query.or(
            `issued_at.gt.${after.issuedAt},and(issued_at.eq.${after.issuedAt},id.gt.${after.id})`,
          );
        }
        return query;
      },
      salesDocumentCursor,
      compareSalesDocumentCursors,
    ),
  );
  const [invoices, payments, services, stocked, locations, team, recent, lines, salesPerformance] = await Promise.all([
    // fetchAllRows: these are aggregated in JS - PostgREST's 1000-row cap would
    // silently understate every headline KPI past 1000 lifetime rows.
    fetchAllRows(() => sb.from("documents").select("id, doc_type, status, total_incl, amount_paid, source_document_id").in("doc_type", ["invoice", "credit_note"]).in("status", ["issued", "partly_paid", "paid"])),
    fetchAllRows(() => sb.from("payments").select("id, method, amount")),
    sb.from("products").select("id", { count: "exact", head: true }).eq("kind", "service"),
    sb.from("products").select("id", { count: "exact", head: true }).eq("is_stocked", true),
    sb.from("stock_locations").select("id", { count: "exact", head: true }),
    sb.from("app_users").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("documents").select("id, doc_type, number, status, total_incl, created_at, customers(name)").order("created_at", { ascending: false }).limit(6),
    fetchAllRows(() => sb.from("document_lines").select("id, title, line_total_excl, qty, documents!inner(status)").eq("documents.status", "paid")),
    salesPerformancePromise,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs: any[] = invoices ?? [];
  const inv = docs.filter((d) => d.doc_type === "invoice");
  // Invoiced = invoices net of live credit notes (a credited sale is not revenue).
  const invoicedCents = docs.reduce((s, d) => s + (d.doc_type === "invoice" ? 1 : -1) * rupeesToCents(Number(d.total_incl)), 0);
  // Outstanding must skip invoices fully reversed by a credit note - the aged
  // receivables report already excludes them; the tile said Rs 5,000 was owed
  // on a sale the credit note had wiped.
  const creditedIds = new Set(docs.filter((d) => d.doc_type === "credit_note" && d.source_document_id).map((d) => d.source_document_id));
  const outstandingCents = inv.reduce(
    (s, d) => s + (creditedIds.has(d.id) ? 0 : rupeesToCents(Number(d.total_incl) - Number(d.amount_paid))),
    0,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pays: any[] = payments ?? [];
  // SIGNED sums: a reversal is a negative mirror row - clamping it to zero kept
  // reversed money in "Collected" forever.
  const collectedCents = pays.reduce((s, p) => s + rupeesToCents(Number(p.amount)), 0);
  const methodMap = new Map<string, number>();
  for (const p of pays) {
    const c = rupeesToCents(Number(p.amount));
    methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + c);
  }
  const byMethod = [...methodMap.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);

  // best-selling services from paid invoices
  const svcMap = new Map<string, { cents: number; qty: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of (lines ?? []) as any[]) {
    const e = svcMap.get(l.title) ?? { cents: 0, qty: 0 };
    e.cents += rupeesToCents(Number(l.line_total_excl));
    e.qty += Number(l.qty);
    svcMap.set(l.title, e);
  }
  const bestServices = [...svcMap.entries()]
    .map(([name, v]) => ({ name, cents: v.cents, qty: v.qty }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 5);

  return {
    invoicedCents,
    collectedCents,
    outstandingCents,
    docCount: inv.length,
    salesPerformance,
    counts: {
      services: services.count ?? 0,
      stocked: stocked.count ?? 0,
      locations: locations.count ?? 0,
      team: team.count ?? 0,
    },
    byMethod,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recent: ((recent.data ?? []) as any[]).map((d) => ({
      id: d.id,
      number: d.number,
      docType: d.doc_type,
      status: d.status,
      totalCents: rupeesToCents(Number(d.total_incl)),
      customer: d.customers?.name ?? null,
      date: muDate(d.created_at as string),
    })),
    bestServices,
  };
}
