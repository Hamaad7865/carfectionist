import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { rupeesToCents, netFromGrossCents } from "@/lib/money";
import { MU_OFFSET_MS } from "@/lib/mu-date";

// Sales Journal — the Cashmag "Journal de ventes" parity report.
//
// Where Daily Summary is one row per business day across many columns, this is the
// other shape: ONE period, aggregated once, broken down five ways down the page —
// sale methods, taxes, payments, categories, users.
//
// ── CASH-RECEIVED BASIS (the owner's call, 9 Sep 2026) ───────────────────────
// Every figure on this report is money that REACHED the business inside the
// period, whatever bill it settled — not what was invoiced. A bill raised on the
// 25th and paid on the 2nd is takings for the 2nd and nothing for the 25th; an
// unpaid bill is not takings at all (it survives only as the ruled-off "On
// account" line). This puts the Taxes section on a cash basis too: the MRA only
// accepts that if the business is approved for cash accounting, which the owner
// acknowledged when choosing it. What was INVOICED still exists as the
// reconciliation figure under the payments card ("of Rs X invoiced") — and in
// Daily Summary, whose Encaissements columns still date money by its bill. The
// two reports therefore disagree by design; they answer different questions.
//
// Document conventions shared with daily-summary.ts:
//   • only issued / partly_paid / paid count (drafts and VOIDs never do)
//   • credit notes carry positive totals and one NEGATIVE mirror payment each;
//     the mirrors net every section down, exactly as a refund should
//   • sale method = which till rang it; no session → "Back office"
//
// ── The invariant that makes this report correct ─────────────────────────────
// Every section foots to the SAME pair of totals: the money received in the
// period. In the owner's reference period: 7196.26 excl / 8275.70 incl, five
// times over. VAT and categories are LINE-derived, but money arrives per
// PAYMENT — so each document's line figures are scaled to the share of the bill
// that was actually paid inside the period (see the allocation pass below).
// When a bill is fully settled here that share is 1 and the figures are the
// document's own; a part-payment contributes its fraction; a credit-note mirror
// contributes negatively. The split itself is `allocate()` — largest-remainder,
// so no cent is invented or lost and the footing holds to the cent.

/** A sale with no till session — invoiced at the desk from a job or a quote.
 *  Not a sale-method row any more (the journal shows one method, the shop); it
 *  survives only as an option in the device filter. */
export const BACK_OFFICE = "Back office";
/** Used when no trading name is available — the DB half always supplies one. */
export const DEFAULT_SALE_METHOD = "SALES";
export const UNCATEGORISED = "(uncategorised)";
/** Fixed display order — Cashmag lists payment methods by kind, not by value. */
export const METHOD_ORDER = ["cash", "card", "juice", "bank_transfer", "cheque"] as const;
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Bank card",
  juice: "Juice",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};

export interface SaleMethodRow {
  label: string;
  tickets: number;
  exclCents: number;
  inclCents: number;
}
export interface TaxRow {
  label: string;
  ratePct: number;
  taxCents: number;
  discountCents: number;
  exclCents: number;
  inclCents: number;
}
/** One bill behind a payment row — what the method's dropdown lists. */
export interface JournalInvoiceRef {
  id: string;
  number: string | null;
  customer: string | null;
  cents: number;
  /** The day the BILL was raised, which is not always the day the money arrived. */
  businessDay: string;
  /** True when the bill predates this period — a customer settling an old debt. */
  earlier: boolean;
}
export interface PaymentRow {
  method: string;
  label: string;
  n: number;
  cents: number;
  /** Every bill this method settled inside the period, newest first. */
  invoices: JournalInvoiceRef[];
}
export interface CategoryRow {
  label: string;
  qty: number;
  pct: number;
  exclCents: number;
  inclCents: number;
}
export interface UserRow {
  label: string;
  tickets: number;
  exclCents: number;
  inclCents: number;
}

export interface SalesJournal {
  from: string;
  to: string;
  /** KPI tiles — all on the money-in basis */
  /** Bills that received money in the period (an unpaid bill is not settled). */
  tickets: number;
  /** Money received in the period, VAT inclusive. THE headline figure. */
  totalInclCents: number;
  /** The ex-VAT content of that money (payments allocated across bill lines). */
  totalExclCents: number;
  /** The VAT content of that money — cash basis, see the header comment. */
  vatCents: number;
  /** Money in per settled bill. */
  avgInclCents: number;
  /** Distinct customers behind the period's money. */
  clients: number;
  clientInclCents: number;
  clientAvgInclCents: number;
  /** sections */
  saleMethods: SaleMethodRow[];
  taxes: TaxRow[];
  payments: PaymentRow[];
  /** Money that came IN during the period, by the day it was RECEIVED — the drawer
   *  view, and what the Z reports. Not the same as what was invoiced: a bill raised
   *  on the 25th and settled on the 2nd is takings for the 2nd.
   *  Equals totalInclCents — the footing every section now shares. */
  paymentsSubtotalCents: number;
  /** …of which settled bills raised BEFORE this period. The bridge line that
   *  explains why money in and invoiced differ. */
  settlingEarlierCents: number;
  /** The bills behind that figure, for the "settling earlier bills" dropdown. */
  settlingEarlier: JournalInvoiceRef[];
  /** Invoiced in this period and still unsettled at the end of it. */
  onAccountCents: number;
  /** Which bills those are — who owes what, for the on-account dropdown. */
  onAccount: JournalInvoiceRef[];
  /** What the period INVOICED — kept only for the on-account reconciliation:
   *      invoiced = (money in − settling earlier bills) + on account
   *  i.e. everything invoiced was either settled inside the period or is owed.
   *  It is NOT the report's total any more; totalInclCents is the money. */
  paymentsTotalCents: number;
  categories: CategoryRow[];
  users: UserRow[];
}

export interface SalesJournalFilters {
  /** resolved sale-method / till name, e.g. "Caisse 1" or "Back office" */
  device?: string;
  /** item name — keeps tickets CONTAINING it (see note below) */
  service?: string;
  /** seller display name */
  user?: string;
  /** time-of-day window in Mauritius local time, "HH:MM" */
  timeFrom?: string;
  timeTo?: string;
}

// ── The pure core ────────────────────────────────────────────────────────────
// Kept free of any database so the money maths can be unit-tested with fixtures.

export interface RawDoc {
  id: string;
  doc_type: "invoice" | "credit_note";
  business_day: string;
  total_incl: number | string;
  subtotal_excl: number | string;
  vat_total: number | string;
  customer_id: string | null;
  issued_by: string | null;
  cash_session_id: string | null;
  issued_at?: string | null;
  /** Shown in the payment and on-account dropdowns. */
  number?: string | null;
}
export interface RawPayment {
  document_id: string;
  method: string;
  amount: number | string;
  /** When the money actually arrived. The journal groups payments by THIS, never by
   *  the document's business_day — that conflation is what made 25 August read
   *  Rs 4,204.20 of cash when only Rs 1,564.20 was taken. */
  received_at?: string | null;
  /** Who took the money — the name a payment counts under in User logs. Falls back
   *  to the bill's issuer when null (back-office recorded settlements). */
  received_by?: string | null;
}
/** The parent bill of a payment, including bills raised outside the period. Carries
 *  its money columns too: a stranger's payment still has to be split into ex-VAT
 *  and VAT for the taxes and categories sections. */
export interface RawPaymentDoc {
  id: string;
  number: string | null;
  business_day: string;
  customer_id: string | null;
  doc_type: "invoice" | "credit_note";
  cash_session_id: string | null;
  issued_by: string | null;
  issued_at?: string | null;
  total_incl: number | string;
  subtotal_excl: number | string;
  vat_total: number | string;
}
export interface RawLine {
  document_id: string;
  title?: string | null;
  qty: number | string;
  unit_price: number | string;
  vat_rate: number | string;
  line_total_excl: number | string;
  line_vat: number | string;
  /** True: unit_price IS the VAT-inclusive gross, so the list basis extracts VAT (20260812000030). */
  price_includes_vat?: boolean | null;
  products?: { name: string; category: string | null } | null;
}
export interface JournalInput {
  docs: RawDoc[];
  payments: RawPayment[];
  /** Lines of BOTH the period's documents and any stranger bills its payments
   *  settled — a stranger's money still has a VAT and category content. */
  lines: RawLine[];
  /** Parent bills of payments raised OUTSIDE the period. The in-period ones come
   *  from `docs`; on this cash-basis report the strangers' money counts in full,
   *  allocated through their own lines. */
  paymentDocs?: RawPaymentDoc[];
  sessionDevice: Map<string, string>; // cash_session_id → device_code
  deviceName: Map<string, string>; // device_code → friendly name
  sellerName: Map<string, string>; // app_user id → display name
  customerName?: Map<string, string>; // customer id → name, for the dropdowns
  /** The shop's one sale method, e.g. "SALES [CARFECTIONIST]". See below. */
  saleMethodLabel?: string;
  filters?: SalesJournalFilters;
}

/** Cashmag's sale-method label: the sale kind, then the shop in brackets. */
export const saleMethodLabelFor = (tradingName: string) => `SALES [${tradingName.toUpperCase()}]`;

/**
 * Split `total` across `weights` so the parts are proportional AND sum to exactly
 * `total` — largest-remainder, so no cent is invented or lost. This is what keeps
 * a document's order-level discount from breaking the footing: the lines are
 * scaled down to the document's real subtotal instead of being summed raw.
 * All-zero weights fall back to an even split (a fully-discounted document).
 */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    // Even split, remainder to the front — nothing to be proportional to.
    const base = Math.trunc(total / n);
    const out = new Array<number>(n).fill(base);
    let rest = total - base * n;
    for (let i = 0; rest !== 0; i = (i + 1) % n) {
      const step = rest > 0 ? 1 : -1;
      out[i] += step;
      rest -= step;
    }
    return out;
  }
  const exact = weights.map((w) => (total * w) / sum);
  const floor = exact.map((x) => Math.trunc(x));
  let rest = total - floor.reduce((a, b) => a + b, 0);
  // Hand the leftover cents to the largest fractional parts first.
  const order = exact
    .map((x, i) => ({ i, frac: Math.abs(x - Math.trunc(x)) }))
    .sort((a, b) => b.frac - a.frac);
  const step = rest >= 0 ? 1 : -1;
  for (let k = 0; rest !== 0 && k < order.length * 2; k++) {
    floor[order[k % order.length].i] += step;
    rest -= step;
  }
  return floor;
}

/** "HH:MM" → minutes since midnight, or null if unparseable. */
function minutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Time-of-day of an ISO timestamp, in Mauritius local minutes. */
function muMinuteOfDay(iso: string): number {
  const d = new Date(Date.parse(iso) + MU_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function taxLabel(ratePct: number): string {
  if (ratePct === 15) return "Standard rate";
  if (ratePct === 0) return "Zero-rated";
  return `${ratePct}% rate`;
}

const empty = (from: string, to: string): SalesJournal => ({
  from, to,
  tickets: 0, totalInclCents: 0, totalExclCents: 0, vatCents: 0, avgInclCents: 0,
  clients: 0, clientInclCents: 0, clientAvgInclCents: 0,
  saleMethods: [], taxes: [], payments: [],
  paymentsSubtotalCents: 0, settlingEarlierCents: 0, settlingEarlier: [],
  onAccountCents: 0, onAccount: [],
  paymentsTotalCents: 0,
  categories: [], users: [],
});

export function buildSalesJournal(from: string, to: string, input: JournalInput): SalesJournal {
  const { payments, lines, sessionDevice, deviceName, sellerName, filters = {} } = input;

  // 1. Resolve each document's dimensions once, then apply the filters at
  //    DOCUMENT level. Filtering whole tickets in or out (rather than individual
  //    lines) is what lets every section keep footing to the same totals — a
  //    line-level filter would leave Categories disagreeing with Sale methods.
  const linesByDoc = new Map<string, RawLine[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.document_id);
    if (arr) arr.push(l);
    else linesByDoc.set(l.document_id, [l]);
  }
  const itemName = (l: RawLine) => (l.products?.name ?? l.title ?? "").trim() || "Ad-hoc item";

  const t0 = minutes(filters.timeFrom);
  const t1 = minutes(filters.timeTo);

  const docs = input.docs.filter((d) => {
    const code = d.cash_session_id ? sessionDevice.get(d.cash_session_id) : null;
    const device = code ? (deviceName.get(code) ?? code) : BACK_OFFICE;
    if (filters.device && device !== filters.device) return false;

    const seller = d.issued_by ? (sellerName.get(d.issued_by) ?? "—") : "—";
    if (filters.user && seller !== filters.user) return false;

    if (filters.service) {
      const has = (linesByDoc.get(d.id) ?? []).some((l) => itemName(l) === filters.service);
      if (!has) return false;
    }

    // A document with no issued_at has no time of day to test, so it stays in
    // rather than being silently dropped from the takings. In practice this is
    // unreachable: issued_at is stamped on issue, and unissued drafts never get
    // this far.
    if ((t0 !== null || t1 !== null) && d.issued_at) {
      const at = muMinuteOfDay(d.issued_at);
      if (t0 !== null && at < t0) return false;
      if (t1 !== null && at > t1) return false;
    }
    return true;
  });

  const keep = new Set(docs.map((d) => d.id));
  const strangerById = new Map<string, RawPaymentDoc>((input.paymentDocs ?? []).map((d) => [d.id, d]));

  // A period can sell nothing and still take money — a customer walking in to clear
  // an old bill. Bailing out on docs alone would report that day as blank and lose
  // the takings. But money against a bill we hold NEITHER way (filtered out, or a
  // draft) counts for nothing, so the shortcut still fires for a filter that matches
  // nothing at all.
  const anyMoney = payments.some((p) => keep.has(p.document_id) || strangerById.has(p.document_id));
  if (docs.length === 0 && !anyMoney) return empty(from, to);
  const sign = (d: RawDoc) => (d.doc_type === "credit_note" ? -1 : 1);

  // 2. The MONEY — every counted payment, once. A payment counts when it arrived
  //    inside the period (the fetch scoped that) and its bill passes the filters.
  //    Everything else in this report derives from that one list: the method rows,
  //    the headline totals, the VAT, the categories, whose name the money lands
  //    under. Nothing about an unpaid bill reaches the figures any more.
  const docById = new Map<string, RawDoc>(input.docs.map((d) => [d.id, d]));
  const customerName = input.customerName ?? new Map<string, string>();

  /** The document behind a payment, whether or not it belongs to this period. */
  const docOf = (id: string): RawDoc | RawPaymentDoc | null => docById.get(id) ?? strangerById.get(id) ?? null;

  // Filters are document-level, so a payment inherits its bill's dimensions. For a
  // bill raised outside the period we hold its till, its seller and its time but
  // never its lines — so a `service` filter cannot be evaluated on it, and it is
  // excluded rather than guessed at.
  const paymentPassesFilters = (docId: string): boolean => {
    if (keep.has(docId)) return true;          // in-period: already filtered above
    const d = strangerById.get(docId);
    if (!d) return false;                       // draft, void, or a doc we never fetched
    if (filters.service) return false;
    const code = d.cash_session_id ? sessionDevice.get(d.cash_session_id) : null;
    const device = code ? (deviceName.get(code) ?? code) : BACK_OFFICE;
    if (filters.device && device !== filters.device) return false;
    const seller = d.issued_by ? (sellerName.get(d.issued_by) ?? "—") : "—";
    if (filters.user && seller !== filters.user) return false;
    if ((t0 !== null || t1 !== null) && d.issued_at) {
      const at = muMinuteOfDay(d.issued_at);
      if (t0 !== null && at < t0) return false;
      if (t1 !== null && at > t1) return false;
    }
    return true;
  };

  const refOf = (docId: string, cents: number): JournalInvoiceRef | null => {
    const d = docOf(docId);
    if (!d) return null;
    return {
      id: d.id,
      number: d.number ?? null,
      customer: d.customer_id ? (customerName.get(d.customer_id) ?? null) : null,
      cents,
      businessDay: d.business_day,
      earlier: !keep.has(docId),
    };
  };
  /** Collapse repeat settlements of one bill into a single dropdown entry. */
  const rollUp = (into: Map<string, JournalInvoiceRef>, ref: JournalInvoiceRef) => {
    const seen = into.get(ref.id);
    if (seen) seen.cents += ref.cents;
    else into.set(ref.id, { ...ref });
  };
  const listOf = (m: Map<string, JournalInvoiceRef>) =>
    [...m.values()].sort((a, b) => (b.businessDay < a.businessDay ? -1 : b.businessDay > a.businessDay ? 1 : Math.abs(b.cents) - Math.abs(a.cents)));

  const userName = (id: string | null | undefined) => (id ? (sellerName.get(id) ?? "—") : "—");

  const paid = new Map<string, PaymentRow>();
  const paidByDoc = new Map<string, number>();       // in-period bills, settled in-period
  const earlierRefs = new Map<string, JournalInvoiceRef>();
  const perMethodRefs = new Map<string, Map<string, JournalInvoiceRef>>();

  /** One payment that counts, with its cents and the user who took the money. */
  interface Counted { cents: number; user: string; }
  const countedByDoc = new Map<string, Counted[]>();

  for (const p of payments) {
    if (!paymentPassesFilters(p.document_id)) continue;
    const cents = rupeesToCents(Number(p.amount)); // the amount carries its own sign
    const row = paid.get(p.method)
      ?? { method: p.method, label: METHOD_LABEL[p.method] ?? p.method, n: 0, cents: 0, invoices: [] };
    row.n += 1;
    row.cents += cents;
    paid.set(p.method, row);

    const ref = refOf(p.document_id, cents);
    if (ref) {
      const per = perMethodRefs.get(p.method) ?? new Map<string, JournalInvoiceRef>();
      rollUp(per, ref);
      perMethodRefs.set(p.method, per);
      if (ref.earlier) rollUp(earlierRefs, ref);
      else paidByDoc.set(p.document_id, (paidByDoc.get(p.document_id) ?? 0) + cents);
    }

    const doc = docOf(p.document_id);
    if (doc) {
      const user = userName(p.received_by ?? doc.issued_by);
      const list = countedByDoc.get(p.document_id);
      if (list) list.push({ cents, user });
      else countedByDoc.set(p.document_id, [{ cents, user }]);
    }
  }

  const paymentRows = [...paid.values()]
    .map((r) => ({ ...r, invoices: listOf(perMethodRefs.get(r.method) ?? new Map()) }))
    .sort((a, b) => {
      const ai = METHOD_ORDER.indexOf(a.method as (typeof METHOD_ORDER)[number]);
      const bi = METHOD_ORDER.indexOf(b.method as (typeof METHOD_ORDER)[number]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  const paymentsSubtotalCents = paymentRows.reduce((a, r) => a + r.cents, 0);
  const settlingEarlier = listOf(earlierRefs);
  const settlingEarlierCents = settlingEarlier.reduce((a, r) => a + r.cents, 0);

  // 3. Cash-basis sections. Each document is scaled to the share of its bill that
  //    the period's payments actually settled, then that share is split across the
  //    lines exactly as before (allocate(), largest-remainder). A fully-settled
  //    bill lands at share 1 — the document's own figures, to the cent; a
  //    part-payment carries its fraction of VAT, discount and category into the
  //    period; a credit-note mirror is negative and nets everything down.
  let totalIncl = 0, totalExcl = 0, clientIncl = 0;
  const settledInvoices = new Set<string>();          // invoice bills that took money
  const clientIds = new Set<string>();
  // Sale method is the SHOP, one row — Cashmag's "SALES [CARFECTIONIST]". The owner
  // does not split takings by terminal here: a job invoiced at the desk and a wash
  // rung on a tablet are both just a sale. Which till rang it is still available as
  // a filter (see `filters.device`), and Daily Summary breaks it out per till for
  // cash-up.
  const saleMethod: SaleMethodRow = { label: input.saleMethodLabel ?? DEFAULT_SALE_METHOD, tickets: 0, exclCents: 0, inclCents: 0 };
  const byUser = new Map<string, UserRow>();
  const userBills = new Map<string, Set<string>>();   // user → the invoice bills they took money on
  const byTax = new Map<number, TaxRow>();
  const byCategory = new Map<string, CategoryRow>();

  for (const [docId, list] of countedByDoc) {
    const doc = docOf(docId)!;
    const paidIncl = list.reduce((a, c) => a + c.cents, 0);
    if (paidIncl === 0) continue; // fully refunded inside the period: no takings either way

    if (doc.doc_type === "invoice" && list.some((c) => c.cents > 0)) settledInvoices.add(docId);
    if (doc.customer_id) {
      clientIds.add(doc.customer_id);
      clientIncl += paidIncl;
    }

    const docIncl = rupeesToCents(Number(doc.total_incl));
    const docExcl = rupeesToCents(Number(doc.subtotal_excl));
    if (docIncl === 0) continue; // a free bill has no VAT content to allocate
    const share = paidIncl / docIncl;
    const paidExcl = Math.round(docExcl * share);

    totalIncl += paidIncl;
    totalExcl += paidExcl;
    saleMethod.exclCents += paidExcl;
    saleMethod.inclCents += paidIncl;

    // The ex-VAT content of each individual payment — users are per-payment, the
    // ex-VAT is per-bill, so the bill's paid ex-VAT is split pro-rata over the
    // payments that settled it (the same allocate trick, one level up).
    const exclByPayment = allocate(paidExcl, list.map((c) => c.cents));
    list.forEach((c, i) => {
      const u = byUser.get(c.user) ?? { label: c.user, tickets: 0, exclCents: 0, inclCents: 0 };
      u.inclCents += c.cents;
      u.exclCents += exclByPayment[i];
      if (c.cents > 0 && doc.doc_type === "invoice") {
        const bills = userBills.get(c.user) ?? new Set<string>();
        bills.add(docId);
        userBills.set(c.user, bills);
      }
      byUser.set(c.user, u);
    });

    // Line-derived sections — the paid share of each line.
    const own = linesByDoc.get(docId);
    if (!own || own.length === 0) continue;

    const rawExcl = own.map((l) => rupeesToCents(Number(l.line_total_excl)));
    const rawVat = own.map((l) => rupeesToCents(Number(l.line_vat)));
    const exclAlloc = allocate(docExcl, rawExcl);
    const vatAlloc = allocate(rupeesToCents(Number(doc.vat_total)), rawVat);
    // List-price (gross) basis for the discount column, scaled the same way. A
    // price_includes_vat line stores unit_price as the GROSS, so extract VAT first
    // (20260812000030); otherwise unit_price is already net.
    const grossOf = own.map((l) => {
      const listCents = rupeesToCents(Number(l.qty) * Number(l.unit_price));
      return l.price_includes_vat === true ? netFromGrossCents(listCents, Number(l.vat_rate)) : listCents;
    });
    const paidGross = Math.round(grossOf.reduce((a, b) => a + b, 0) * share);
    // Three independent largest-remainder splits — excl, VAT, gross — each footing
    // to its doc-level paid figure, so every column foots AND every row keeps the
    // identity incl = excl + tax. (Deriving tax as incl − excl per line instead
    // would flip signs on a mixed-rate document: a zero-rated line next to a 15%
    // one shares the incl split differently than the excl split.)
    const paidVat = paidIncl - paidExcl;
    const linePaidExcl = allocate(paidExcl, exclAlloc);
    const linePaidTax = allocate(paidVat, vatAlloc);
    const linePaidGross = allocate(paidGross, grossOf);

    own.forEach((l, i) => {
      const excl = linePaidExcl[i];
      const tax = linePaidTax[i];
      const ratePct = Number(l.vat_rate);

      const t = byTax.get(ratePct) ?? { label: taxLabel(ratePct), ratePct, taxCents: 0, discountCents: 0, exclCents: 0, inclCents: 0 };
      t.taxCents += tax;
      t.exclCents += excl;
      t.inclCents += excl + tax;
      t.discountCents += linePaidGross[i] - excl;
      byTax.set(ratePct, t);

      const cat = (l.products?.category ?? "").trim() || UNCATEGORISED;
      const c = byCategory.get(cat) ?? { label: cat, qty: 0, pct: 0, exclCents: 0, inclCents: 0 };
      c.qty += share * Number(l.qty); // fractional for a part-payment — shown to 2dp
      c.exclCents += excl;
      c.inclCents += excl + tax;
      byCategory.set(cat, c);
    });
  }

  const tickets = settledInvoices.size;
  saleMethod.tickets = tickets;
  for (const u of byUser.values()) u.tickets = userBills.get(u.label)?.size ?? 0;

  // 4. What the period INVOICED — no longer the report's total (that is the money
  //    above), but the anchor the on-account reconciliation hangs off:
  //      invoiced = (money in − settling earlier bills) + on account
  let invoicedIncl = 0;
  for (const d of docs) invoicedIncl += sign(d) * rupeesToCents(Number(d.total_incl));

  // On account: raised in this period, not settled inside it. A partly-settled bill
  // contributes only its unpaid remainder, so the identity above holds to the cent.
  const onAccountMap = new Map<string, JournalInvoiceRef>();
  for (const d of docs) {
    const owed = sign(d) * rupeesToCents(Number(d.total_incl)) - (paidByDoc.get(d.id) ?? 0);
    if (owed === 0) continue;
    const ref = refOf(d.id, owed);
    if (ref) onAccountMap.set(d.id, ref);
  }
  const onAccount = listOf(onAccountMap);
  const onAccountCents = onAccount.reduce((a, r) => a + r.cents, 0);

  // 5. Ordering + the category share.
  const categories = [...byCategory.values()].sort((a, b) => b.exclCents - a.exclCents);
  for (const c of categories) c.pct = totalExcl !== 0 ? (c.exclCents / totalExcl) * 100 : 0;

  return {
    from, to,
    tickets,
    totalInclCents: totalIncl,
    totalExclCents: totalExcl,
    vatCents: totalIncl - totalExcl,
    avgInclCents: tickets ? Math.round(totalIncl / tickets) : 0,
    clients: clientIds.size,
    clientInclCents: clientIncl,
    clientAvgInclCents: clientIds.size ? Math.round(clientIncl / clientIds.size) : 0,
    saleMethods: [saleMethod],
    taxes: [...byTax.values()].sort((a, b) => a.ratePct - b.ratePct),
    payments: paymentRows,
    paymentsSubtotalCents,
    settlingEarlierCents,
    settlingEarlier,
    onAccountCents,
    onAccount,
    paymentsTotalCents: invoicedIncl,
    categories,
    users: [...byUser.values()].sort((a, b) => b.inclCents - a.inclCents),
  };
}

// ── The database half ────────────────────────────────────────────────────────
// Same fetch as getDailySummary (paged, so a long range can't silently truncate
// at PostgREST's 1000-row cap), plus the columns this report needs: the line's
// list price for the discount column, the product's category, and issued_at for
// the time-of-day filter.

/** A fresh empty input each call — a shared one would hand every caller the same
 *  mutable Maps. */
const emptyInput = (): JournalInput => ({
  docs: [], payments: [], lines: [], paymentDocs: [],
  sessionDevice: new Map(), deviceName: new Map(), sellerName: new Map(), customerName: new Map(),
});

/** The period as an instant range in Mauritius local time. business_day is already a
 *  local date; payments.received_at is a timestamptz, so it has to be bracketed
 *  explicitly or a late-evening payment lands on the wrong day. */
const MU_DAY_START = (d: string) => `${d}T00:00:00.000+04:00`;
const MU_DAY_END = (d: string) => `${d}T23:59:59.999+04:00`;

/** One round-trip for a period. Shared by the page, the PDF and the comparison run. */
export async function fetchJournalInput(from: string, to: string): Promise<JournalInput> {
  const sb = await createClient();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const DOC_COLUMNS = "id, doc_type, business_day, total_incl, subtotal_excl, vat_total, customer_id, issued_by, cash_session_id, issued_at, number";
  const LIVE = ["issued", "partly_paid", "paid"]; // drafts and VOIDs never count

  // Two independent axes, deliberately fetched apart:
  //   • what was INVOICED here — documents by business_day. Drives revenue.
  //   • what money CAME IN here — payments by received_at. Drives the payments
  //     section, and reaches bills raised long before this period.
  const [docs, payments] = await Promise.all([
    fetchAllRows<any>(() =>
      sb
        .from("documents")
        .select(DOC_COLUMNS)
        .in("doc_type", ["invoice", "credit_note"])
        .in("status", LIVE)
        .gte("business_day", from)
        .lte("business_day", to),
    ),
    fetchAllRows<any>(() =>
      sb
        .from("payments")
        .select("id, document_id, method, amount, received_at, received_by")
        .gte("received_at", MU_DAY_START(from))
        .lte("received_at", MU_DAY_END(to)),
    ),
  ]);

  // Nothing sold AND nothing collected — only then is the period genuinely blank.
  if (docs.length === 0 && payments.length === 0) return emptyInput();

  const docIds = docs.map((d) => d.id);
  // Bills settled here but raised elsewhere. Fetched with the same status filter, so
  // money against a draft or a voided bill is dropped exactly as it always was.
  const inPeriod = new Set<string>(docIds);
  const strangerIds = [...new Set(payments.map((p) => p.document_id).filter((id: string) => id && !inPeriod.has(id)))] as string[];
  const paymentDocs = strangerIds.length
    ? await fetchAllRows<any>(() =>
        sb.from("documents").select(DOC_COLUMNS).in("id", strangerIds).in("status", LIVE),
      )
    : [];
  // Tills and sellers must cover the strangers too, or a filter would silently drop
  // every payment that settled an older bill. User logs are keyed by who RECEIVED
  // the money, so the app_users lookup must cover received_by as well.
  const everyDoc = [...docs, ...paymentDocs];
  const sessionIds = [...new Set(everyDoc.map((d) => d.cash_session_id).filter(Boolean))] as string[];
  const sellerIds = [
    ...new Set([
      ...everyDoc.map((d) => d.issued_by).filter(Boolean),
      ...payments.map((p) => p.received_by).filter(Boolean),
    ]),
  ] as string[];
  const customerIds = [...new Set(everyDoc.map((d) => d.customer_id).filter(Boolean))] as string[];

  // Lines cover the stranger bills as well now: their money counts in full, so its
  // VAT and category content has to come from somewhere. They can only ever reach
  // the totals THROUGH a payment — the aggregation never iterates docs alone.
  const lineDocIds = [...docIds, ...strangerIds];
  const [lines, sessions, sellers, devices, customers, settings] = await Promise.all([
    fetchAllRows<any>(() =>
      sb
        .from("document_lines")
        .select("id, document_id, title, qty, unit_price, vat_rate, line_total_excl, line_vat, price_includes_vat, products(name, category)")
        .in("document_id", lineDocIds),
    ),
    sessionIds.length ? fetchAllRows<any>(() => sb.from("cash_sessions").select("id, device_id").in("id", sessionIds)) : Promise.resolve([] as any[]),
    sellerIds.length ? fetchAllRows<any>(() => sb.from("app_users").select("id, display_name").in("id", sellerIds)) : Promise.resolve([] as any[]),
    fetchAllRows<any>(() => sb.from("devices").select("device_code, display_name")),
    customerIds.length ? fetchAllRows<any>(() => sb.from("customers").select("id, name").in("id", customerIds)) : Promise.resolve([] as any[]),
    // Rides along in the same round-trip — it names the single sale-method row.
    sb.from("business_settings").select("trading_name").limit(1).maybeSingle(),
  ]);

  return {
    docs: docs as RawDoc[],
    payments: payments as RawPayment[],
    paymentDocs: paymentDocs as RawPaymentDoc[],
    lines: lines as RawLine[],
    sessionDevice: new Map(sessions.map((s) => [s.id, s.device_id])),
    deviceName: new Map(devices.map((d) => [d.device_code, d.display_name || d.device_code])),
    sellerName: new Map(sellers.map((u) => [u.id, u.display_name || "—"])),
    customerName: new Map(customers.map((c) => [c.id, c.name as string])),
    saleMethodLabel: saleMethodLabelFor(settings.data?.trading_name || "Carfectionist"),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function getSalesJournal(from: string, to: string, filters: SalesJournalFilters = {}): Promise<SalesJournal> {
  const input = await fetchJournalInput(from, to);
  return buildSalesJournal(from, to, { ...input, filters });
}

/**
 * The journal plus the values the More-filters dialog offers. Facets are taken
 * from the UNFILTERED period — otherwise picking a till would erase every other
 * till from the dropdown and you could never switch back.
 */
export async function getSalesJournalPage(
  from: string,
  to: string,
  filters: SalesJournalFilters = {},
): Promise<{ journal: SalesJournal; facets: JournalFacets }> {
  const input = await fetchJournalInput(from, to);
  return {
    journal: buildSalesJournal(from, to, { ...input, filters }),
    facets: facetsOf(input),
  };
}

/** The shop name that heads the journal, on screen and on the PDF. */
export async function getTradingName(): Promise<string> {
  const sb = await createClient();
  const { data } = await sb.from("business_settings").select("trading_name").limit(1).maybeSingle();
  return (data as { trading_name?: string } | null)?.trading_name ?? "Carfectionist";
}

/** The distinct values the More-filters dialog offers, discovered from the period. */
export interface JournalFacets {
  devices: string[];
  services: string[];
  users: string[];
}

export function facetsOf(input: JournalInput): JournalFacets {
  const devices = new Set<string>();
  const users = new Set<string>();
  const services = new Set<string>();
  for (const d of input.docs) {
    const code = d.cash_session_id ? input.sessionDevice.get(d.cash_session_id) : null;
    devices.add(code ? (input.deviceName.get(code) ?? code) : BACK_OFFICE);
    users.add(d.issued_by ? (input.sellerName.get(d.issued_by) ?? "—") : "—");
  }
  // Services come from the period's OWN documents only. The fetch now carries
  // stranger bills' lines too (their money needs them), but a service the period
  // never sold has no business in the period's filter dropdown.
  const inPeriod = new Set(input.docs.map((d) => d.id));
  for (const l of input.lines) if (inPeriod.has(l.document_id)) services.add((l.products?.name ?? l.title ?? "").trim() || "Ad-hoc item");
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { devices: sorted(devices), services: sorted(services), users: sorted(users) };
}
