import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { rupeesToCents } from "@/lib/money";
import { MU_OFFSET_MS } from "@/lib/mu-date";

// Sales Journal — the Cashmag "Journal de ventes" parity report.
//
// Where Daily Summary is one row per business day across many columns, this is the
// other shape: ONE period, aggregated once, broken down five ways down the page —
// sale methods, taxes, payments, categories, users.
//
// Money conventions are inherited verbatim from daily-summary.ts, or the two
// reports would contradict each other on the same dates:
//   • grouped by `business_day`, not issue_date
//   • only issued / partly_paid / paid count (drafts and VOIDs never do)
//   • credit notes NET DOWN the period (they carry a -1 sign)
//   • "tickets" counts sales invoices only — a credit note reduces money, it is
//     not itself a sale
//   • sale method = which till rang it; no session → "Back office"
//
// ── The invariant that makes this report correct ─────────────────────────────
// Every section foots to the SAME pair of totals. In the owner's reference
// period: 7196.26 excl / 8275.70 incl, five times over. That only holds if the
// line-derived sections (taxes, categories) are built from each document's
// subtotal_excl — the figure AFTER a whole-sale discount — rather than from raw
// line totals, which only carry the per-line discount. See allocate() below.

/** A sale with no till session — invoiced at the desk from a job or a quote.
 *  Not a sale-method row any more (the journal shows one method, the shop); it
 *  survives only as an option in the device filter. */
export const BACK_OFFICE = "Back office";
/** Used when no trading name is available — the DB half always supplies one. */
export const DEFAULT_SALE_METHOD = "SALES";
export const UNCATEGORISED = "(uncategorised)";
/** Fixed display order — Cashmag lists payment methods by kind, not by value. */
export const METHOD_ORDER = ["cash", "card", "juice", "bank_transfer"] as const;
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Bank card",
  juice: "Juice",
  bank_transfer: "Bank transfer",
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
export interface PaymentRow {
  method: string;
  label: string;
  n: number;
  cents: number;
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
  /** KPI tiles */
  tickets: number;
  totalInclCents: number;
  totalExclCents: number;
  vatCents: number;
  avgInclCents: number;
  clients: number;
  clientInclCents: number;
  clientAvgInclCents: number;
  /** sections */
  saleMethods: SaleMethodRow[];
  taxes: TaxRow[];
  payments: PaymentRow[];
  /** Σ of real payment rows — Cashmag's "S/TOTAL (EXCL CREDITS)". */
  paymentsSubtotalCents: number;
  /** …plus whatever was delivered on account. Equals totalInclCents by construction. */
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
}
export interface RawPayment { document_id: string; method: string; amount: number | string }
export interface RawLine {
  document_id: string;
  title?: string | null;
  qty: number | string;
  unit_price: number | string;
  vat_rate: number | string;
  line_total_excl: number | string;
  line_vat: number | string;
  products?: { name: string; category: string | null } | null;
}
export interface JournalInput {
  docs: RawDoc[];
  payments: RawPayment[];
  lines: RawLine[];
  sessionDevice: Map<string, string>; // cash_session_id → device_code
  deviceName: Map<string, string>; // device_code → friendly name
  sellerName: Map<string, string>; // app_user id → display name
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
  paymentsSubtotalCents: 0, paymentsTotalCents: 0,
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

  if (docs.length === 0) return empty(from, to);

  const keep = new Set(docs.map((d) => d.id));
  const sign = (d: RawDoc) => (d.doc_type === "credit_note" ? -1 : 1);

  // 2. Document-level figures — the totals every section must foot to.
  let tickets = 0, totalIncl = 0, totalExcl = 0, vat = 0, clientIncl = 0;
  const clientIds = new Set<string>();
  const saleMethod: SaleMethodRow = { label: input.saleMethodLabel ?? DEFAULT_SALE_METHOD, tickets: 0, exclCents: 0, inclCents: 0 };
  const byUser = new Map<string, UserRow>();

  for (const d of docs) {
    const s = sign(d);
    const incl = s * rupeesToCents(Number(d.total_incl));
    const excl = s * rupeesToCents(Number(d.subtotal_excl));
    totalIncl += incl;
    totalExcl += excl;
    vat += s * rupeesToCents(Number(d.vat_total));
    if (d.doc_type === "invoice") tickets += 1;

    if (d.customer_id) {
      clientIds.add(d.customer_id);
      clientIncl += incl;
    }

    // Sale method is the SHOP, one row — Cashmag's "SALES [CAFECTIONIST]". The
    // owner does not split takings by terminal here: a job invoiced at the desk
    // and a wash rung on a tablet are both just a sale. Which till rang it is
    // still available as a filter (see `filters.device`), and Daily Summary
    // still breaks it out per till for cash-up.
    saleMethod.tickets += d.doc_type === "invoice" ? 1 : 0;
    saleMethod.exclCents += excl;
    saleMethod.inclCents += incl;

    const seller = d.issued_by ? (sellerName.get(d.issued_by) ?? "—") : "—";
    const u = byUser.get(seller) ?? { label: seller, tickets: 0, exclCents: 0, inclCents: 0 };
    u.tickets += d.doc_type === "invoice" ? 1 : 0;
    u.exclCents += excl;
    u.inclCents += incl;
    byUser.set(seller, u);
  }

  // 3. Line-derived sections, on ALLOCATED figures.
  //    Each document's subtotal_excl and vat_total are split across its own lines
  //    in proportion to the raw line totals. When there is no whole-sale discount
  //    this is the identity; when there is one, it scales every line down so the
  //    taxes and categories still add up to the document.
  const byTax = new Map<number, TaxRow>();
  const byCategory = new Map<string, CategoryRow>();

  for (const d of docs) {
    const own = linesByDoc.get(d.id);
    if (!own || own.length === 0) continue;
    const s = sign(d);

    const rawExcl = own.map((l) => rupeesToCents(Number(l.line_total_excl)));
    const rawVat = own.map((l) => rupeesToCents(Number(l.line_vat)));
    const exclAlloc = allocate(rupeesToCents(Number(d.subtotal_excl)), rawExcl);
    const vatAlloc = allocate(rupeesToCents(Number(d.vat_total)), rawVat);

    own.forEach((l, i) => {
      const excl = s * exclAlloc[i];
      const tax = s * vatAlloc[i];
      // Gross = what the line would have been at list price, before BOTH the
      // per-line discount and this line's share of the whole-sale discount.
      const gross = s * rupeesToCents(Number(l.qty) * Number(l.unit_price));

      const ratePct = Number(l.vat_rate);
      const t = byTax.get(ratePct) ?? { label: taxLabel(ratePct), ratePct, taxCents: 0, discountCents: 0, exclCents: 0, inclCents: 0 };
      t.taxCents += tax;
      t.exclCents += excl;
      t.inclCents += excl + tax;
      t.discountCents += gross - excl;
      byTax.set(ratePct, t);

      const cat = (l.products?.category ?? "").trim() || UNCATEGORISED;
      const c = byCategory.get(cat) ?? { label: cat, qty: 0, pct: 0, exclCents: 0, inclCents: 0 };
      c.qty += s * Number(l.qty);
      c.exclCents += excl;
      c.inclCents += excl + tax;
      byCategory.set(cat, c);
    });
  }

  // 4. Payments. The subtotal is the real tendered money; the total additionally
  //    carries whatever was delivered on account, so it always equals the
  //    period's takings — which is exactly Cashmag's
  //    "S/TOTAL (HORS CRÉDITS)" vs "Total" pair.
  const paid = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (!keep.has(p.document_id)) continue;
    const row = paid.get(p.method) ?? { method: p.method, label: METHOD_LABEL[p.method] ?? p.method, n: 0, cents: 0 };
    row.n += 1;
    row.cents += rupeesToCents(Number(p.amount)); // the amount carries its own sign
    paid.set(p.method, row);
  }
  const paymentRows = [...paid.values()].sort((a, b) => {
    const ai = METHOD_ORDER.indexOf(a.method as (typeof METHOD_ORDER)[number]);
    const bi = METHOD_ORDER.indexOf(b.method as (typeof METHOD_ORDER)[number]);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const paymentsSubtotalCents = paymentRows.reduce((a, r) => a + r.cents, 0);

  // 5. Ordering + the category share.
  const categories = [...byCategory.values()].sort((a, b) => b.exclCents - a.exclCents);
  for (const c of categories) c.pct = totalExcl !== 0 ? (c.exclCents / totalExcl) * 100 : 0;

  return {
    from, to,
    tickets,
    totalInclCents: totalIncl,
    totalExclCents: totalExcl,
    vatCents: vat,
    avgInclCents: tickets ? Math.round(totalIncl / tickets) : 0,
    clients: clientIds.size,
    clientInclCents: clientIncl,
    clientAvgInclCents: clientIds.size ? Math.round(clientIncl / clientIds.size) : 0,
    saleMethods: [saleMethod],
    taxes: [...byTax.values()].sort((a, b) => a.ratePct - b.ratePct),
    payments: paymentRows,
    paymentsSubtotalCents,
    paymentsTotalCents: totalIncl,
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
  docs: [], payments: [], lines: [],
  sessionDevice: new Map(), deviceName: new Map(), sellerName: new Map(),
});

/** One round-trip for a period. Shared by the page, the PDF and the comparison run. */
export async function fetchJournalInput(from: string, to: string): Promise<JournalInput> {
  const sb = await createClient();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const docs = await fetchAllRows<any>(() =>
    sb
      .from("documents")
      .select("id, doc_type, business_day, total_incl, subtotal_excl, vat_total, customer_id, issued_by, cash_session_id, issued_at")
      .in("doc_type", ["invoice", "credit_note"])
      .in("status", ["issued", "partly_paid", "paid"]) // drafts and VOIDs never count
      .gte("business_day", from)
      .lte("business_day", to),
  );

  if (docs.length === 0) return emptyInput();

  const docIds = docs.map((d) => d.id);
  const sessionIds = [...new Set(docs.map((d) => d.cash_session_id).filter(Boolean))] as string[];
  const sellerIds = [...new Set(docs.map((d) => d.issued_by).filter(Boolean))] as string[];

  const [payments, lines, sessions, sellers, devices, settings] = await Promise.all([
    fetchAllRows<any>(() => sb.from("payments").select("id, document_id, method, amount").in("document_id", docIds)),
    fetchAllRows<any>(() =>
      sb
        .from("document_lines")
        .select("id, document_id, title, qty, unit_price, vat_rate, line_total_excl, line_vat, products(name, category)")
        .in("document_id", docIds),
    ),
    sessionIds.length ? fetchAllRows<any>(() => sb.from("cash_sessions").select("id, device_id").in("id", sessionIds)) : Promise.resolve([] as any[]),
    sellerIds.length ? fetchAllRows<any>(() => sb.from("app_users").select("id, display_name").in("id", sellerIds)) : Promise.resolve([] as any[]),
    fetchAllRows<any>(() => sb.from("devices").select("device_code, display_name")),
    // Rides along in the same round-trip — it names the single sale-method row.
    sb.from("business_settings").select("trading_name").limit(1).maybeSingle(),
  ]);

  return {
    docs: docs as RawDoc[],
    payments: payments as RawPayment[],
    lines: lines as RawLine[],
    sessionDevice: new Map(sessions.map((s) => [s.id, s.device_id])),
    deviceName: new Map(devices.map((d) => [d.device_code, d.display_name || d.device_code])),
    sellerName: new Map(sellers.map((u) => [u.id, u.display_name || "—"])),
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
  for (const l of input.lines) services.add((l.products?.name ?? l.title ?? "").trim() || "Ad-hoc item");
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { devices: sorted(devices), services: sorted(services), users: sorted(users) };
}
