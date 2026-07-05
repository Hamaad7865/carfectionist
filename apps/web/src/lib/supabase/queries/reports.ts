import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface PaymentReportRow {
  id: string;
  date: string;
  number: string | null;
  customer: string | null;
  method: string;
  amountCents: number;
}

export interface ReportsData {
  payments: PaymentReportRow[];
  byMethod: { method: string; cents: number }[];
  collectedCents: number;
  invoicedCents: number;
  outstandingCents: number;
  vat: { outputCents: number; inputCents: number; netCents: number };
  aged: { label: string; cents: number }[];
}

function daysBetween(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.floor((now - t) / 86_400_000);
}

const PAYMENT_METHODS = ["cash", "card", "juice", "bank_transfer"];

export async function getReportsData(from?: string, to?: string, method?: string): Promise<ReportsData> {
  const sb = await createClient();

  let payQ = sb
    .from("payments")
    .select("id, method, amount, received_at, documents(number, customers(name))")
    .order("received_at", { ascending: false })
    .limit(500);
  if (from) payQ = payQ.gte("received_at", from);
  if (to) payQ = payQ.lte("received_at", `${to}T23:59:59`);
  if (method && PAYMENT_METHODS.includes(method)) payQ = payQ.eq("method", method);

  // Input VAT is period revenue/tax, so scope expenses to the range.
  let expQ = sb.from("expenses").select("vat_amount, expense_date");
  if (from) expQ = expQ.gte("expense_date", from);
  if (to) expQ = expQ.lte("expense_date", to);

  const [payRes, invRes, expRes] = await Promise.all([
    payQ,
    // Fetch all invoices (aged receivables = true current position); revenue/VAT
    // figures are scoped to the range in JS below.
    sb.from("documents").select("total_incl, vat_total, amount_paid, status, issue_date").eq("doc_type", "invoice").in("status", ["issued", "partly_paid", "paid"]),
    expQ,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments: PaymentReportRow[] = ((payRes.data ?? []) as any[])
    .filter((p) => Number(p.amount) > 0)
    .map((p) => ({
      id: p.id,
      date: (p.received_at as string).slice(0, 16).replace("T", " "),
      number: p.documents?.number ?? null,
      customer: p.documents?.customers?.name ?? null,
      method: p.method,
      amountCents: rupeesToCents(Number(p.amount)),
    }));

  const methodMap = new Map<string, number>();
  for (const p of payments) methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + p.amountCents);
  const byMethod = [...methodMap.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);
  const collectedCents = payments.reduce((s, p) => s + p.amountCents, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoices = (invRes.data ?? []) as any[];
  // Revenue invoiced + output VAT are period figures → scope to the date range
  // (issue_date). Outstanding/aged below intentionally stay all-open.
  const inRange = (d: string | null) => (!from || (d != null && d >= from)) && (!to || (d != null && d <= to));
  const rangedInvoices = from || to ? invoices.filter((d) => inRange(d.issue_date)) : invoices;
  const invoicedCents = rangedInvoices.reduce((s, d) => s + rupeesToCents(Number(d.total_incl)), 0);
  const outputVat = rangedInvoices.reduce((s, d) => s + rupeesToCents(Number(d.vat_total)), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputVat = ((expRes.data ?? []) as any[]).reduce((s, e) => s + rupeesToCents(Number(e.vat_amount)), 0);

  const now = Date.now();
  const buckets = [
    { label: "0–30 days", cents: 0 },
    { label: "31–60 days", cents: 0 },
    { label: "61–90 days", cents: 0 },
    { label: "90+ days", cents: 0 },
  ];
  let outstandingCents = 0;
  for (const d of invoices) {
    if (!["issued", "partly_paid"].includes(d.status)) continue;
    const owed = rupeesToCents(Number(d.total_incl) - Number(d.amount_paid));
    if (owed <= 0) continue;
    outstandingCents += owed;
    const age = d.issue_date ? daysBetween(d.issue_date, now) : 0;
    const i = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    buckets[i].cents += owed;
  }

  return {
    payments,
    byMethod,
    collectedCents,
    invoicedCents,
    outstandingCents,
    vat: { outputCents: outputVat, inputCents: inputVat, netCents: outputVat - inputVat },
    aged: buckets,
  };
}

// ── P&L · best-sellers · revenue by technician ───────────────────────────────
export interface ExtraReports {
  pnl: { revenueCents: number; cogsCents: number; grossCents: number; expensesCents: number; netCents: number };
  bestSellers: { name: string; qty: number; revenueCents: number }[];
  byTechnician: { name: string; revenueCents: number; jobs: number }[];
}

export async function getExtraReports(from?: string, to?: string): Promise<ExtraReports> {
  const sb = await createClient();

  let invQ = sb
    .from("documents")
    .select("subtotal_excl, issue_date, jobs(technician_id, app_users!jobs_technician_id_fkey(display_name))")
    .eq("doc_type", "invoice")
    .in("status", ["issued", "partly_paid", "paid"]);
  if (from) invQ = invQ.gte("issue_date", from);
  if (to) invQ = invQ.lte("issue_date", to);

  let expQ = sb.from("expenses").select("amount, expense_date");
  if (from) expQ = expQ.gte("expense_date", from);
  if (to) expQ = expQ.lte("expense_date", to);

  // COGS = cost of stock that left on sales (invoice) and job consumption (job_card).
  let mvQ = sb.from("stock_movements").select("qty, unit_cost, ref_type, moved_at").in("ref_type", ["invoice", "job_card"]);
  if (from) mvQ = mvQ.gte("moved_at", from);
  if (to) mvQ = mvQ.lte("moved_at", `${to}T23:59:59`);

  let lineQ = sb
    .from("document_lines")
    .select("title, qty, line_total_excl, documents!inner(doc_type, status, issue_date)")
    .eq("documents.doc_type", "invoice")
    .in("documents.status", ["issued", "partly_paid", "paid"]);
  if (from) lineQ = lineQ.gte("documents.issue_date", from);
  if (to) lineQ = lineQ.lte("documents.issue_date", to);

  const [invRes, expRes, mvRes, lineRes] = await Promise.all([invQ, expQ, mvQ, lineQ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const invoices = (invRes.data ?? []) as any[];
  const revenueCents = invoices.reduce((s, d) => s + rupeesToCents(Number(d.subtotal_excl)), 0);
  const expensesCents = ((expRes.data ?? []) as any[]).reduce((s, e) => s + rupeesToCents(Number(e.amount)), 0);
  const cogsCents = ((mvRes.data ?? []) as any[]).reduce((s, m) => {
    const q = Number(m.qty);
    return q < 0 ? s + rupeesToCents(-q * Number(m.unit_cost)) : s;
  }, 0);
  const grossCents = revenueCents - cogsCents;
  const netCents = grossCents - expensesCents;

  // best-sellers by line title
  const bs = new Map<string, { qty: number; revenueCents: number }>();
  for (const l of (lineRes.data ?? []) as any[]) {
    const key = (l.title as string) || "—";
    const cur = bs.get(key) ?? { qty: 0, revenueCents: 0 };
    cur.qty += Number(l.qty);
    cur.revenueCents += rupeesToCents(Number(l.line_total_excl));
    bs.set(key, cur);
  }
  const bestSellers = [...bs.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenueCents: v.revenueCents }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 12);

  // revenue by technician (standalone/counter invoices bucket as "Counter / unassigned")
  const techs = new Map<string, { revenueCents: number; jobs: number }>();
  for (const d of invoices) {
    const name = d.jobs?.app_users?.display_name ?? "Counter / unassigned";
    const cur = techs.get(name) ?? { revenueCents: 0, jobs: 0 };
    cur.revenueCents += rupeesToCents(Number(d.subtotal_excl));
    cur.jobs += d.jobs ? 1 : 0;
    techs.set(name, cur);
  }
  const byTechnician = [...techs.entries()]
    .map(([name, v]) => ({ name, revenueCents: v.revenueCents, jobs: v.jobs }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    pnl: { revenueCents, cogsCents, grossCents, expensesCents, netCents },
    bestSellers,
    byTechnician,
  };
}
