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
    // Invoices (aged receivables = true current position) + credit notes, which
    // net down revenue/output VAT. Range-scoped in JS below.
    sb.from("documents").select("doc_type, total_incl, vat_total, amount_paid, status, issue_date").in("doc_type", ["invoice", "credit_note"]).in("status", ["issued", "partly_paid", "paid"]),
    expQ,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Keep reversal mirrors (negative amounts) so collected/by-method net correctly.
  const payments: PaymentReportRow[] = ((payRes.data ?? []) as any[])
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
  const allDocs = (invRes.data ?? []) as any[];
  const invoices = allDocs.filter((d) => d.doc_type === "invoice");
  const creditNotes = allDocs.filter((d) => d.doc_type === "credit_note");
  // Revenue invoiced + output VAT are period figures → scope to the date range
  // (issue_date), and net down by credit notes. Outstanding/aged stay all-open.
  const inRange = (d: string | null) => (!from || (d != null && d >= from)) && (!to || (d != null && d <= to));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ranged = (rows: any[]) => (from || to ? rows.filter((d) => inRange(d.issue_date)) : rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sumCents = (rows: any[], f: string) => rows.reduce((s, d) => s + rupeesToCents(Number(d[f])), 0);
  const invoicedCents = sumCents(ranged(invoices), "total_incl") - sumCents(ranged(creditNotes), "total_incl");
  const outputVat = sumCents(ranged(invoices), "vat_total") - sumCents(ranged(creditNotes), "vat_total");
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

  // Credit notes net down revenue.
  let cnQ = sb.from("documents").select("subtotal_excl, issue_date").eq("doc_type", "credit_note").eq("status", "issued");
  if (from) cnQ = cnQ.gte("issue_date", from);
  if (to) cnQ = cnQ.lte("issue_date", to);

  let expQ = sb.from("expenses").select("amount, expense_date");
  if (from) expQ = expQ.gte("expense_date", from);
  if (to) expQ = expQ.lte("expense_date", to);

  // COGS = cost of stock out on sales (invoice) + job consumption, minus credit-note
  // restock (credit_note movements are +qty, which nets COGS down).
  let mvQ = sb.from("stock_movements").select("qty, unit_cost, ref_type, moved_at").in("ref_type", ["invoice", "job_card", "credit_note"]);
  if (from) mvQ = mvQ.gte("moved_at", from);
  if (to) mvQ = mvQ.lte("moved_at", `${to}T23:59:59`);

  let lineQ = sb
    .from("document_lines")
    .select("title, qty, line_total_excl, documents!inner(doc_type, status, issue_date)")
    .eq("documents.doc_type", "invoice")
    .in("documents.status", ["issued", "partly_paid", "paid"]);
  if (from) lineQ = lineQ.gte("documents.issue_date", from);
  if (to) lineQ = lineQ.lte("documents.issue_date", to);

  const [invRes, cnRes, expRes, mvRes, lineRes] = await Promise.all([invQ, cnQ, expQ, mvQ, lineQ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const invoices = (invRes.data ?? []) as any[];
  const creditNotes = (cnRes.data ?? []) as any[];
  const revenueCents =
    invoices.reduce((s, d) => s + rupeesToCents(Number(d.subtotal_excl)), 0) -
    creditNotes.reduce((s, d) => s + rupeesToCents(Number(d.subtotal_excl)), 0);
  const expensesCents = ((expRes.data ?? []) as any[]).reduce((s, e) => s + rupeesToCents(Number(e.amount)), 0);
  // Net COGS: -qty*cost over sale/job (out, +COGS) and credit-note (in, −COGS).
  const cogsCents = ((mvRes.data ?? []) as any[]).reduce((s, m) => s + rupeesToCents(-Number(m.qty) * Number(m.unit_cost)), 0);
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

// ── Customer statement ────────────────────────────────────────────────────────
const STMT_METHOD: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank transfer" };

export interface StatementLine {
  date: string; // yyyy-mm-dd
  kind: "invoice" | "payment" | "credit_note";
  ref: string | null;
  detail: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}
export interface CustomerStatement {
  customerId: string;
  customerName: string;
  openingCents: number;
  lines: StatementLine[];
  invoicedCents: number; // debits in range
  settledCents: number; // credits in range (payments + credit notes)
  closingCents: number; // balance due at the statement end (opening + in-range net)
}

export async function getStatementCustomers(): Promise<{ id: string; name: string }[]> {
  const sb = await createClient();
  const { data } = await sb.from("customers").select("id, name").order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name }));
}

export async function getCustomerStatement(customerId: string, from?: string, to?: string): Promise<CustomerStatement | null> {
  const sb = await createClient();
  const { data: cust } = await sb.from("customers").select("id, name").eq("id", customerId).maybeSingle();
  if (!cust) return null;

  const [docRes, payRes] = await Promise.all([
    // Issued invoices (debits) + credit notes (credits); void/draft excluded.
    sb.from("documents").select("doc_type, number, total_incl, issue_date").eq("customer_id", customerId).in("doc_type", ["invoice", "credit_note"]).in("status", ["issued", "partly_paid", "paid"]),
    // Payments against this customer's documents (credits). Reversal mirrors keep the sign.
    sb.from("payments").select("amount, received_at, method, documents!inner(number, customer_id)").eq("documents.customer_id", customerId),
  ]);

  type Ev = { date: string; kind: StatementLine["kind"]; ref: string | null; detail: string; debit: number; credit: number; seq: number };
  const evs: Ev[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (docRes.data ?? []) as any[]) {
    if (!d.issue_date) continue;
    const cents = rupeesToCents(Number(d.total_incl));
    if (d.doc_type === "invoice") evs.push({ date: d.issue_date, kind: "invoice", ref: d.number, detail: "Invoice", debit: cents, credit: 0, seq: 0 });
    else evs.push({ date: d.issue_date, kind: "credit_note", ref: d.number, detail: "Credit note", debit: 0, credit: cents, seq: 1 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (payRes.data ?? []) as any[]) {
    evs.push({ date: (p.received_at as string).slice(0, 10), kind: "payment", ref: p.documents?.number ?? null, detail: `Payment · ${STMT_METHOD[p.method] ?? p.method}`, debit: 0, credit: rupeesToCents(Number(p.amount)), seq: 2 });
  }
  // by date, then debits (invoices) before credits on the same day
  evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));

  let opening = 0;
  for (const e of evs) if (from && e.date < from) opening += e.debit - e.credit;

  let bal = opening;
  let invoiced = 0;
  let settled = 0;
  const lines: StatementLine[] = [];
  for (const e of evs) {
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    bal += e.debit - e.credit;
    invoiced += e.debit;
    settled += e.credit;
    lines.push({ date: e.date, kind: e.kind, ref: e.ref, detail: e.detail, debitCents: e.debit, creditCents: e.credit, balanceCents: bal });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { customerId, customerName: (cust as any).name, openingCents: opening, lines, invoicedCents: invoiced, settledCents: settled, closingCents: bal };
}
