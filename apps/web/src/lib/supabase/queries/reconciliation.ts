import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { muToday } from "@/lib/mu-date";
import { getSettleableInvoices } from "./reports";

// Reconciliation — "what does this customer owe, and when did they pay".
// Visibility only: nothing here takes money or forgives it. Settlement still
// goes through the settle panel, which this module embeds where the debt is.
//
// The owing LIST reuses the statement of accounts (live invoices + carried
// Cashmag balances); everything below answers the questions that roster
// can't: how old is each debt, what was paid toward each bill, and which
// rows look wrong (overdue, overpaid).

/** The slip's own vocabulary for tender methods. */
export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  juice: "Juice",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  points: "Points",
};
export const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

/** One invoice the customer still owes money on. */
export interface OpenReceivable {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  /** yyyy-mm-dd; null when the bill was never issued with a date. */
  issueDate: string | null;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toReceivable(d: any): OpenReceivable | null {
  const outstandingCents = rupeesToCents(Number(d.total_incl) - Number(d.amount_paid));
  if (outstandingCents <= 0) return null;
  return {
    id: d.id,
    number: d.number ?? null,
    customerId: d.customer_id,
    customerName: d.customers?.name ?? "—",
    issueDate: d.issue_date ?? null,
    totalCents: rupeesToCents(Number(d.total_incl)),
    paidCents: rupeesToCents(Number(d.amount_paid)),
    outstandingCents,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Every open receivable in the shop, oldest first — the raw material for the
 * owing list's age badges and the exceptions tab. Credit-noted invoices are
 * excluded with the same rule settlement uses (a credited bill is not owed).
 */
export async function getOpenReceivables(): Promise<OpenReceivable[]> {
  const sb = await createClient();
  const rows = await fetchAllRows(() =>
    sb
      .from("documents")
      .select("id, number, customer_id, issue_date, total_incl, amount_paid, doc_type, status, source_document_id, customers(name)")
      .in("doc_type", ["invoice", "credit_note"])
      .in("status", ["issued", "partly_paid"]),
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const docs = rows as any[];
  const creditedIds = new Set(
    docs.filter((d) => d.doc_type === "credit_note").map((d) => d.source_document_id).filter(Boolean),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return docs
    .filter((d) => d.doc_type === "invoice" && !creditedIds.has(d.id))
    .map(toReceivable)
    .filter((r): r is OpenReceivable => r !== null)
    .sort((a, b) => (a.issueDate ?? "9999-99-99") < (b.issueDate ?? "9999-99-99") ? -1 : 1);
}

export interface TrailPayment {
  id: string;
  amountCents: number;
  method: string;
  /** Received instant; muDate() renders the Mauritius day. */
  receivedAt: string;
}

/** One open bill with every payment taken toward it, oldest first. */
export interface InvoiceTrail {
  id: string;
  number: string | null;
  issueDate: string | null;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  payments: TrailPayment[];
}

/**
 * Attach payment rows to their invoices, oldest payment first. Pure — the
 * fetcher below supplies the rows, the tests supply literals.
 */
export function buildInvoiceTrails(
  invoices: { id: string; number: string | null; issueDate: string | null; totalCents: number; paidCents: number; outstandingCents: number }[],
  payments: { id: string; documentId: string; amountCents: number; method: string; receivedAt: string }[],
): InvoiceTrail[] {
  const byDoc = new Map<string, TrailPayment[]>();
  for (const p of [...payments].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0))) {
    const arr = byDoc.get(p.documentId) ?? [];
    arr.push({ id: p.id, amountCents: p.amountCents, method: p.method, receivedAt: p.receivedAt });
    byDoc.set(p.documentId, arr);
  }
  return invoices.map((inv) => ({ ...inv, payments: byDoc.get(inv.id) ?? [] }));
}

/** What a customer still owes on open bills, and what was paid toward each one. */
export async function getCustomerInvoiceTrails(customerId: string): Promise<InvoiceTrail[]> {
  const open = await getSettleableInvoices(customerId);
  if (open.length === 0) return [];
  const sb = await createClient();
  const payRows = await fetchAllRows(() =>
    sb
      .from("payments")
      .select("id, document_id, amount, method, received_at")
      .in("document_id", open.map((i) => i.id))
      .order("received_at", { ascending: true }),
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const payments = (payRows as any[]).map((p) => ({
    id: p.id as string,
    documentId: p.document_id as string,
    amountCents: rupeesToCents(Number(p.amount)),
    method: p.method as string,
    receivedAt: p.received_at as string,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return buildInvoiceTrails(
    open.map((i) => ({
      id: i.id,
      number: i.number,
      issueDate: i.issueDate,
      totalCents: i.outstandingCents + i.paidCents,
      paidCents: i.paidCents,
      outstandingCents: i.outstandingCents,
    })),
    payments,
  );
}

// ── Ageing ────────────────────────────────────────────────────────────────

function daysSince(iso10: string, today: string): number {
  // Plain dates anchor to Mauritius midnight, like the reports buckets do.
  const t = Date.parse(`${iso10}T00:00:00+04:00`);
  const n = Date.parse(`${today}T00:00:00+04:00`);
  if (Number.isNaN(t) || Number.isNaN(n)) return 0;
  return Math.floor((n - t) / 86_400_000);
}

/** Whole days since a yyyy-mm-dd bill date, in Mauritius time. */
export const ageDays = (issueDate: string, today: string) => daysSince(issueDate, today);

/** Bills unpaid past the grace period — visibility, never enforcement. */
export const OVERDUE_GRACE_DAYS = 30;

export interface OverdueCustomer {
  customerId: string;
  customerName: string;
  bills: number;
  overdueCents: number;
  oldestDate: string;
  maxDaysOverdue: number;
}

/**
 * Roll open receivables past their grace period up per customer, most overdue
 * money first. Undated bills can't be aged and stay out. Pure.
 */
export function buildOverdueCustomers(
  rows: { customerId: string; customerName: string; issueDate: string | null; outstandingCents: number }[],
  today: string,
  graceDays = OVERDUE_GRACE_DAYS,
): OverdueCustomer[] {
  const byCustomer = new Map<string, OverdueCustomer>();
  for (const r of rows) {
    if (!r.issueDate) continue;
    const daysOverdue = daysSince(r.issueDate, today) - graceDays;
    if (daysOverdue <= 0) continue;
    const cur = byCustomer.get(r.customerId) ?? {
      customerId: r.customerId,
      customerName: r.customerName,
      bills: 0,
      overdueCents: 0,
      oldestDate: r.issueDate,
      maxDaysOverdue: 0,
    };
    cur.bills += 1;
    cur.overdueCents += r.outstandingCents;
    if (r.issueDate < cur.oldestDate) cur.oldestDate = r.issueDate;
    if (daysOverdue > cur.maxDaysOverdue) cur.maxDaysOverdue = daysOverdue;
    byCustomer.set(r.customerId, cur);
  }
  return [...byCustomer.values()].sort((a, b) => b.overdueCents - a.overdueCents);
}

export interface CustomerAging {
  customerId: string;
  openBills: number;
  openCents: number;
  /** Oldest open bill, for the list's age badge; null when undated. */
  oldestDate: string | null;
}

/** Per-customer age signal for the owing list. Pure. */
export function buildCustomerAging(
  rows: { customerId: string; issueDate: string | null; outstandingCents: number }[],
): CustomerAging[] {
  const byCustomer = new Map<string, CustomerAging>();
  for (const r of rows) {
    const cur = byCustomer.get(r.customerId) ?? { customerId: r.customerId, openBills: 0, openCents: 0, oldestDate: null };
    cur.openBills += 1;
    cur.openCents += r.outstandingCents;
    if (r.issueDate && (cur.oldestDate === null || r.issueDate < cur.oldestDate)) cur.oldestDate = r.issueDate;
    byCustomer.set(r.customerId, cur);
  }
  return [...byCustomer.values()];
}

// ── Overpayments ──────────────────────────────────────────────────────────

export interface OverpaymentLine {
  invoiceId: string;
  number: string | null;
  customerId: string;
  customerName: string;
  totalCents: number;
  paidCents: number;
  excessCents: number;
}

/** Paid invoices where the till took more than the bill — refund-or-carry candidates. Pure. */
export function buildOverpayments(
  rows: { id: string; number: string | null; customerId: string; customerName: string; totalCents: number; paidCents: number }[],
): OverpaymentLine[] {
  return rows
    .filter((r) => r.paidCents > r.totalCents)
    .map((r) => ({ invoiceId: r.id, number: r.number, customerId: r.customerId, customerName: r.customerName, totalCents: r.totalCents, paidCents: r.paidCents, excessCents: r.paidCents - r.totalCents }))
    .sort((a, b) => b.excessCents - a.excessCents);
}

/** Paid-shop-wide scan for over-taken bills, biggest excess first. */
export async function getOverpaidInvoices(limit = 200): Promise<OverpaymentLine[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("documents")
    .select("id, number, customer_id, total_incl, amount_paid, customers(name)")
    .eq("doc_type", "invoice")
    .eq("status", "paid")
    .order("amount_paid", { ascending: false })
    .limit(limit * 4);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = ((data ?? []) as any[]).map((d) => ({
    id: d.id as string,
    number: (d.number ?? null) as string | null,
    customerId: d.customer_id as string,
    customerName: d.customers?.name ?? "—",
    totalCents: rupeesToCents(Number(d.total_incl)),
    paidCents: rupeesToCents(Number(d.amount_paid)),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return buildOverpayments(rows).slice(0, limit);
}

export interface ReconciliationExceptions {
  overdue: OverdueCustomer[];
  overpaid: OverpaymentLine[];
}

/** Everything on the exceptions tab in one round trip pair. */
export async function getReconciliationExceptions(today = muToday(), graceDays = OVERDUE_GRACE_DAYS): Promise<ReconciliationExceptions> {
  const [open, overpaid] = await Promise.all([getOpenReceivables(), getOverpaidInvoices()]);
  return { overdue: buildOverdueCustomers(open, today, graceDays), overpaid };
}
