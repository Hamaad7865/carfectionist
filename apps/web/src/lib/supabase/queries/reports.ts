import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { fetchAllRows } from "@/lib/supabase/paginate";

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

// Mauritius is UTC+4 (no DST). Build day bounds so timestamptz filters don't
// misassign transactions recorded near local midnight.
const MU = "+04:00";
const dayStart = (d: string) => `${d}T00:00:00${MU}`;
const dayEnd = (d: string) => `${d}T23:59:59.999${MU}`;

export async function getReportsData(from?: string, to?: string, method?: string): Promise<ReportsData> {
  const sb = await createClient();

  let payQ = sb
    .from("payments")
    .select("id, method, amount, received_at, documents(number, customers(name))")
    .order("received_at", { ascending: false })
    .limit(500);
  if (from) payQ = payQ.gte("received_at", dayStart(from));
  if (to) payQ = payQ.lte("received_at", dayEnd(to));
  if (method && PAYMENT_METHODS.includes(method)) payQ = payQ.eq("method", method);

  // Money totals must NOT be derived from the capped display list — aggregate a
  // separate (amount, method) query, PAGED past the PostgREST 1000-row cap so
  // collected/by-method never silently undercount.
  const makeTotQ = () => {
    let q = sb.from("payments").select("method, amount");
    if (from) q = q.gte("received_at", dayStart(from));
    if (to) q = q.lte("received_at", dayEnd(to));
    if (method && PAYMENT_METHODS.includes(method)) q = q.eq("method", method);
    return q;
  };
  // Input VAT is period revenue/tax, so scope expenses to the range.
  const makeExpQ = () => {
    let q = sb.from("expenses").select("vat_amount, expense_date");
    if (from) q = q.gte("expense_date", from);
    if (to) q = q.lte("expense_date", to);
    return q;
  };
  // Invoices (aged receivables = true current position) + credit notes, which
  // net down revenue/output VAT. Range-scoped in JS below. All-time → must page.
  const makeInvQ = () =>
    sb.from("documents").select("id, doc_type, total_incl, vat_total, amount_paid, status, issue_date, source_document_id").in("doc_type", ["invoice", "credit_note"]).in("status", ["issued", "partly_paid", "paid"]);

  const [payRes, totRows, invRows, expRows] = await Promise.all([
    payQ,
    fetchAllRows(makeTotQ),
    fetchAllRows(makeInvQ),
    fetchAllRows(makeExpQ),
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

  // Uncapped aggregation for the money figures (payments[] above is a display slice).
  const methodMap = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of totRows as any[]) methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + rupeesToCents(Number(p.amount)));
  const byMethod = [...methodMap.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents);
  const collectedCents = [...methodMap.values()].reduce((s, v) => s + v, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allDocs = invRows as any[];
  const invoices = allDocs.filter((d) => d.doc_type === "invoice");
  const creditNotes = allDocs.filter((d) => d.doc_type === "credit_note");
  // An invoice fully reversed by a live credit note owes nothing.
  const creditedIds = new Set(creditNotes.map((cn) => cn.source_document_id).filter(Boolean));
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
  const inputVat = (expRows as any[]).reduce((s, e) => s + rupeesToCents(Number(e.vat_amount)), 0);

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
    if (creditedIds.has(d.id)) continue; // fully reversed by a credit note
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

  // Every query below is PAGED past the PostgREST 1000-row cap (factories return
  // a fresh filtered query per page).
  const makeInvQ = () => {
    let q = sb.from("documents").select("subtotal_excl, issue_date, jobs(technician_id, app_users!jobs_technician_id_fkey(display_name))").eq("doc_type", "invoice").in("status", ["issued", "partly_paid", "paid"]);
    if (from) q = q.gte("issue_date", from);
    if (to) q = q.lte("issue_date", to);
    return q;
  };
  // Credit notes net down revenue (and technician revenue).
  const makeCnQ = () => {
    let q = sb.from("documents").select("subtotal_excl, issue_date, jobs(technician_id, app_users!jobs_technician_id_fkey(display_name))").eq("doc_type", "credit_note").eq("status", "issued");
    if (from) q = q.gte("issue_date", from);
    if (to) q = q.lte("issue_date", to);
    return q;
  };
  const makeExpQ = () => {
    let q = sb.from("expenses").select("amount, expense_date");
    if (from) q = q.gte("expense_date", from);
    if (to) q = q.lte("expense_date", to);
    return q;
  };
  // COGS = cost of stock out on sales (invoice) + job consumption, minus credit-note
  // restock (+qty). Void docs' movements are excluded below.
  const makeMvQ = () => {
    let q = sb.from("stock_movements").select("qty, unit_cost, ref_type, ref_id, moved_at").in("ref_type", ["invoice", "job_card", "credit_note"]);
    if (from) q = q.gte("moved_at", dayStart(from));
    if (to) q = q.lte("moved_at", dayEnd(to));
    return q;
  };
  // Documents that are void — their sale/restock movements must not count in COGS.
  const makeVoidQ = () => sb.from("documents").select("id").eq("status", "void").in("doc_type", ["invoice", "credit_note"]);
  const makeLineQ = () => {
    let q = sb.from("document_lines").select("title, qty, line_total_excl, documents!inner(doc_type, status, issue_date)").eq("documents.doc_type", "invoice").in("documents.status", ["issued", "partly_paid", "paid"]);
    if (from) q = q.gte("documents.issue_date", from);
    if (to) q = q.lte("documents.issue_date", to);
    return q;
  };

  const [invoicesRaw, creditNotesRaw, expRows, mvRows, lineRows, voidRows] = await Promise.all([
    fetchAllRows(makeInvQ), fetchAllRows(makeCnQ), fetchAllRows(makeExpQ), fetchAllRows(makeMvQ), fetchAllRows(makeLineQ), fetchAllRows(makeVoidQ),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const invoices = invoicesRaw as any[];
  const creditNotes = creditNotesRaw as any[];
  const revenueCents =
    invoices.reduce((s, d) => s + rupeesToCents(Number(d.subtotal_excl)), 0) -
    creditNotes.reduce((s, d) => s + rupeesToCents(Number(d.subtotal_excl)), 0);
  const expensesCents = (expRows as any[]).reduce((s, e) => s + rupeesToCents(Number(e.amount)), 0);
  // Net COGS: -qty*cost over sale/job (out, +COGS) and credit-note (in, −COGS),
  // excluding movements that belong to a voided invoice/credit note.
  const voidDocIds = new Set((voidRows as any[]).map((d) => d.id));
  const cogsCents = (mvRows as any[])
    .filter((m) => !((m.ref_type === "invoice" || m.ref_type === "credit_note") && voidDocIds.has(m.ref_id)))
    .reduce((s, m) => s + rupeesToCents(-Number(m.qty) * Number(m.unit_cost)), 0);
  const grossCents = revenueCents - cogsCents;
  const netCents = grossCents - expensesCents;

  // best-sellers by line title
  const bs = new Map<string, { qty: number; revenueCents: number }>();
  for (const l of lineRows as any[]) {
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
  // Credit notes reduce the technician's revenue (returns/refunds).
  for (const d of creditNotes) {
    const name = d.jobs?.app_users?.display_name ?? "Counter / unassigned";
    const cur = techs.get(name) ?? { revenueCents: 0, jobs: 0 };
    cur.revenueCents -= rupeesToCents(Number(d.subtotal_excl));
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

// ── Discounts given ───────────────────────────────────────────────────────────
export interface DiscountReportRow {
  id: string;
  date: string | null;
  number: string | null;
  customer: string | null;
  grossExclCents: number;      // ex-VAT before any discount
  lineDiscountCents: number;   // ex-VAT, from per-line discounts
  orderDiscountCents: number;  // ex-VAT, from the whole-sale discount
  totalDiscountCents: number;  // line + order
  netTotalCents: number;       // inclusive total charged
  discountPct: number;         // of gross ex-VAT
}
export interface DiscountsReport {
  rows: DiscountReportRow[];
  totalDiscountCents: number;
  lineDiscountCents: number;
  orderDiscountCents: number;
  grossExclCents: number;      // over ALL invoices in range (discounted or not)
  discountedCount: number;
  invoiceCount: number;
}

/** Discounts given on issued invoices in the range. Ex-VAT revenue foregone,
 *  split into per-line vs whole-sale discount. Total discount ex-VAT =
 *  Σ(qty·unit_price) − subtotal_excl (gross before any discount − net taxable). */
export async function getDiscountsReport(from?: string, to?: string): Promise<DiscountsReport> {
  const sb = await createClient();

  const makeDocQ = () => {
    let q = sb.from("documents").select("id, number, issue_date, subtotal_excl, total_incl, customers(name)").eq("doc_type", "invoice").in("status", ["issued", "partly_paid", "paid"]);
    if (from) q = q.gte("issue_date", from);
    if (to) q = q.lte("issue_date", to);
    return q;
  };
  const makeLineQ = () => {
    let q = sb.from("document_lines").select("document_id, qty, unit_price, line_total_excl, documents!inner(doc_type, status, issue_date)").eq("documents.doc_type", "invoice").in("documents.status", ["issued", "partly_paid", "paid"]);
    if (from) q = q.gte("documents.issue_date", from);
    if (to) q = q.lte("documents.issue_date", to);
    return q;
  };

  const [docRows, lineRows] = await Promise.all([fetchAllRows(makeDocQ), fetchAllRows(makeLineQ)]);

  // Per-doc gross (pre-discount) and post-line-discount subtotals, both ex-VAT.
  const perDoc = new Map<string, { gross: number; net0: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of lineRows as any[]) {
    const g = perDoc.get(l.document_id) ?? { gross: 0, net0: 0 };
    g.gross += rupeesToCents(Number(l.qty) * Number(l.unit_price));
    g.net0 += rupeesToCents(Number(l.line_total_excl));
    perDoc.set(l.document_id, g);
  }

  const rows: DiscountReportRow[] = [];
  let totalDiscount = 0, lineDiscount = 0, orderDiscount = 0, grossSum = 0, discountedCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of docRows as any[]) {
    const netExcl = rupeesToCents(Number(d.subtotal_excl));
    const agg = perDoc.get(d.id) ?? { gross: netExcl, net0: netExcl };
    const lineDisc = Math.max(0, agg.gross - agg.net0);
    const orderDisc = Math.max(0, agg.net0 - netExcl);
    const totalDisc = Math.max(0, agg.gross - netExcl);
    grossSum += agg.gross;
    if (totalDisc > 1) {
      totalDiscount += totalDisc; lineDiscount += lineDisc; orderDiscount += orderDisc; discountedCount += 1;
      rows.push({
        id: d.id,
        date: d.issue_date,
        number: d.number,
        customer: d.customers?.name ?? null,
        grossExclCents: agg.gross,
        lineDiscountCents: lineDisc,
        orderDiscountCents: orderDisc,
        totalDiscountCents: totalDisc,
        netTotalCents: rupeesToCents(Number(d.total_incl)),
        discountPct: agg.gross > 0 ? (totalDisc / agg.gross) * 100 : 0,
      });
    }
  }
  rows.sort((a, b) => b.totalDiscountCents - a.totalDiscountCents);

  return {
    rows,
    totalDiscountCents: totalDiscount,
    lineDiscountCents: lineDiscount,
    orderDiscountCents: orderDiscount,
    grossExclCents: grossSum,
    discountedCount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoiceCount: (docRows as any[]).length,
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
