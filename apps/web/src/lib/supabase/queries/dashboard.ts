import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
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

export async function getDashboard(input: SalesPeriodInput = {}): Promise<DashboardData> {
  const sb = await createClient();
  const period = resolveSalesPeriod(input);
  const salesQuery = salesQuerySpec(period);
  const salesPerformancePromise = settleSalesPerformance(
    period,
    fetchAllRows<SalesDocumentRow>(
      () => sb
        .from("documents")
        .select(salesQuery.columns)
        .in("doc_type", salesQuery.docTypes)
        .in("status", salesQuery.statuses)
        .not("issued_at", "is", null)
        .gte("issued_at", salesQuery.startIso)
        .lt("issued_at", salesQuery.endExclusiveIso),
      "id",
    ),
  );
  const [invoices, payments, services, stocked, locations, team, recent, lines, salesPerformance] = await Promise.all([
    sb.from("documents").select("total_incl, amount_paid").eq("doc_type", "invoice").in("status", ["issued", "partly_paid", "paid"]),
    sb.from("payments").select("method, amount"),
    sb.from("products").select("id", { count: "exact", head: true }).eq("kind", "service"),
    sb.from("products").select("id", { count: "exact", head: true }).eq("is_stocked", true),
    sb.from("stock_locations").select("id", { count: "exact", head: true }),
    sb.from("app_users").select("id", { count: "exact", head: true }).eq("is_active", true),
    sb.from("documents").select("id, doc_type, number, status, total_incl, created_at, customers(name)").order("created_at", { ascending: false }).limit(6),
    sb.from("document_lines").select("title, line_total_excl, qty, documents!inner(status)").eq("documents.status", "paid"),
    salesPerformancePromise,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv: any[] = invoices.data ?? [];
  const invoicedCents = inv.reduce((s, d) => s + rupeesToCents(Number(d.total_incl)), 0);
  const outstandingCents = inv.reduce((s, d) => s + rupeesToCents(Number(d.total_incl) - Number(d.amount_paid)), 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pays: any[] = payments.data ?? [];
  const collectedCents = pays.reduce((s, p) => s + Math.max(0, rupeesToCents(Number(p.amount))), 0);
  const methodMap = new Map<string, number>();
  for (const p of pays) {
    const c = rupeesToCents(Number(p.amount));
    if (c > 0) methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + c);
  }
  const byMethod = [...methodMap.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);

  // best-selling services from paid invoices
  const svcMap = new Map<string, { cents: number; qty: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of (lines.data ?? []) as any[]) {
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
