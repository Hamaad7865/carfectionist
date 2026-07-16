import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { rupeesToCents } from "@/lib/money";

// Daily Summary — the Cashmag "Synthèse quotidienne" parity report.
//
// One row per BUSINESS DAY in the range (including days with no sales, so the
// calendar reads honestly), plus a totals row. Grouped by `business_day` rather
// than issue_date: a sale rung at 9pm belongs to that till's day, which is what
// makes this agree with the cash-up.
//
// Money conventions are deliberately identical to lib/.../reports.ts, or the
// summary would contradict the VAT and P&L reports:
//   • only issued / partly_paid / paid documents count (drafts and VOIDs never do)
//   • credit notes NET DOWN the day (they carry a -1 sign)
//   • "tickets" counts sales invoices only — a credit note reduces money, it is
//     not itself a sale
//
// Breakdown columns (devices/methods/taxes/sellers/services) are discovered from
// the data, exactly as Cashmag's export does — a service only gets a column if it
// actually sold in the period.

export interface Bucket {
  cents: number;
  n: number; // tickets, or payment count
}
export interface TaxBucket {
  inclCents: number;
  exclCents: number;
  taxCents: number;
}

export interface DailySummaryRow {
  day: string; // YYYY-MM-DD
  tickets: number;
  totalInclCents: number;
  totalExclCents: number;
  vatCents: number;
  avgInclCents: number;
  avgExclCents: number;
  clients: number;
  byDevice: Record<string, Bucket>;
  byMethod: Record<string, Bucket>;
  byTax: Record<string, TaxBucket>;
  bySeller: Record<string, Bucket>;
  byService: Record<string, Bucket>;
}

export interface DailySummary {
  rows: DailySummaryRow[];
  totals: DailySummaryRow;
  devices: string[];
  methods: string[];
  taxes: string[];
  sellers: string[];
  services: string[];
}

export const OTHER_SERVICES = "Other items";
const TOP_SERVICES = 15;

/** Every YYYY-MM-DD from..to inclusive — so a day with no sales still shows. */
export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (isNaN(start) || isNaN(end) || end < start) return out;
  // Guard a runaway range (a typo'd year shouldn't build 300k rows).
  for (let t = start, i = 0; t <= end && i < 400; t += 86_400_000, i++) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function emptyRow(day: string): DailySummaryRow {
  return {
    day, tickets: 0, totalInclCents: 0, totalExclCents: 0, vatCents: 0,
    avgInclCents: 0, avgExclCents: 0, clients: 0,
    byDevice: {}, byMethod: {}, byTax: {}, bySeller: {}, byService: {},
  };
}

function add(map: Record<string, Bucket>, key: string, cents: number, n = 0) {
  const b = (map[key] ??= { cents: 0, n: 0 });
  b.cents += cents;
  b.n += n;
}

// ── The pure core ────────────────────────────────────────────────────────────
// Kept free of any database so the money maths can be unit-tested with fixtures:
// credit notes netting down, voids never arriving, the totals row equalling the
// sum of the days, and "Other services" reconciling.

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
}
export interface RawPayment { document_id: string; method: string; amount: number | string }
export interface RawLine {
  document_id: string;
  title?: string | null;
  vat_rate: number | string;
  line_total_excl: number | string;
  line_vat: number | string;
  products?: { name: string; kind: string } | null;
}
export interface SummaryInput {
  docs: RawDoc[];
  payments: RawPayment[];
  lines: RawLine[];
  sessionDevice: Map<string, string>; // cash_session_id → device_code
  deviceName: Map<string, string>; // device_code → friendly name
  sellerName: Map<string, string>; // app_user id → display name
}

export function buildDailySummary(from: string, to: string, input: SummaryInput): DailySummary {
  const { docs, payments, lines, sessionDevice, deviceName, sellerName } = input;
  const days = daysInRange(from, to);
  const byDay = new Map<string, DailySummaryRow>(days.map((d) => [d, emptyRow(d)]));
  const dayCustomers = new Map<string, Set<string>>(days.map((d) => [d, new Set<string>()]));
  const allCustomers = new Set<string>();

  const rowsEmpty = days.map((d) => byDay.get(d)!);
  if (docs.length === 0) {
    return { rows: rowsEmpty, totals: emptyRow("total"), devices: [], methods: [], taxes: [], sellers: [], services: [] };
  }

  const sign = (d: RawDoc) => (d.doc_type === "credit_note" ? -1 : 1);
  const docDay = new Map<string, string>(docs.map((d) => [d.id, d.business_day]));
  const docSign = new Map<string, number>(docs.map((d) => [d.id, sign(d)]));

  // 3. Per-document figures.
  for (const d of docs) {
    const row = byDay.get(d.business_day);
    if (!row) continue; // outside the generated range (defensive)
    const s = sign(d);
    row.totalInclCents += s * rupeesToCents(Number(d.total_incl));
    row.totalExclCents += s * rupeesToCents(Number(d.subtotal_excl));
    row.vatCents += s * rupeesToCents(Number(d.vat_total));
    if (d.doc_type === "invoice") row.tickets += 1;

    if (d.customer_id) {
      dayCustomers.get(d.business_day)?.add(d.customer_id);
      allCustomers.add(d.customer_id);
    }

    // Sale method = which till rang it. No session → the back office.
    const code = d.cash_session_id ? sessionDevice.get(d.cash_session_id) : null;
    const device = code ? (deviceName.get(code) ?? code) : "Back office";
    add(row.byDevice, device, s * rupeesToCents(Number(d.total_incl)), d.doc_type === "invoice" ? 1 : 0);

    const seller = d.issued_by ? (sellerName.get(d.issued_by) ?? "—") : "—";
    add(row.bySeller, seller, s * rupeesToCents(Number(d.total_incl)), d.doc_type === "invoice" ? 1 : 0);
  }

  // 4. Payments (Encaissements) — grouped by the day of the ticket they settle,
  //    which is how Cashmag's payment columns sum to that day's total.
  for (const p of payments) {
    const day = docDay.get(p.document_id);
    const row = day ? byDay.get(day) : null;
    if (!row) continue;
    // amount carries its own sign (a reversal is a negative mirror).
    add(row.byMethod, p.method, rupeesToCents(Number(p.amount)), 1);
  }

  // 5. Lines → tax bands and services.
  const serviceDocs = new Map<string, Set<string>>(); // item name → doc ids (for ticket counts)
  for (const l of lines) {
    const day = docDay.get(l.document_id);
    const row = day ? byDay.get(day) : null;
    if (!row) continue;
    const s = docSign.get(l.document_id) ?? 1;
    const excl = s * rupeesToCents(Number(l.line_total_excl));
    const tax = s * rupeesToCents(Number(l.line_vat));

    const band = `${Number(l.vat_rate)}%`;
    const t = (row.byTax[band] ??= { inclCents: 0, exclCents: 0, taxCents: 0 });
    t.exclCents += excl;
    t.taxCents += tax;
    t.inclCents += excl + tax;

    // Cashmag's "Services" section is really "what did we sell" — their whole
    // catalogue is services. Ours isn't: most revenue is products, and ad-hoc
    // typed lines have no product at all. Keying on kind='service' would hide
    // ~93% of a day, so every sold line counts, named by its product or its
    // own title.
    const name = (l.products?.name ?? l.title ?? "").trim() || "Ad-hoc item";
    add(row.byService, name, excl + tax, 0);
    const set = serviceDocs.get(name) ?? new Set<string>();
    set.add(l.document_id);
    serviceDocs.set(name, set);
  }
  // An item's "tickets" = how many documents contained it (not how many lines).
  for (const [name, docSet] of serviceDocs) {
    const perDay = new Map<string, number>();
    for (const id of docSet) {
      const day = docDay.get(id);
      if (day) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    for (const [day, n] of perDay) {
      const row = byDay.get(day);
      if (row?.byService[name]) row.byService[name].n = n;
    }
  }

  // 6. Averages + client counts per day.
  for (const [day, row] of byDay) {
    row.clients = dayCustomers.get(day)?.size ?? 0;
    row.avgInclCents = row.tickets ? Math.round(row.totalInclCents / row.tickets) : 0;
    row.avgExclCents = row.tickets ? Math.round(row.totalExclCents / row.tickets) : 0;
  }

  const rows = days.map((d) => byDay.get(d)!);

  // 7. Column keys — only what actually occurred, ranked by money.
  const rank = (pick: (r: DailySummaryRow) => Record<string, Bucket>) => {
    const tot = new Map<string, number>();
    for (const r of rows) for (const [k, b] of Object.entries(pick(r))) tot.set(k, (tot.get(k) ?? 0) + b.cents);
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const deviceKeys = rank((r) => r.byDevice);
  const methodKeys = rank((r) => r.byMethod);
  const sellerKeys = rank((r) => r.bySeller);
  const taxKeys = [...new Set(rows.flatMap((r) => Object.keys(r.byTax)))].sort();

  // Items: top N by revenue across the period, the rest folded into "Other
  // items" so the section still reconciles to the day's sales.
  const allServices = rank((r) => r.byService);
  const top = allServices.slice(0, TOP_SERVICES);
  const rest = new Set(allServices.slice(TOP_SERVICES));
  if (rest.size > 0) {
    for (const r of rows) {
      for (const name of Object.keys(r.byService)) {
        if (!rest.has(name)) continue;
        const b = r.byService[name];
        add(r.byService, OTHER_SERVICES, b.cents, b.n);
        delete r.byService[name];
      }
    }
  }
  const serviceKeys = rest.size > 0 ? [...top, OTHER_SERVICES] : top;

  // 8. The totals row — summed from the day rows, so it can never disagree.
  const totals = emptyRow("total");
  for (const r of rows) {
    totals.tickets += r.tickets;
    totals.totalInclCents += r.totalInclCents;
    totals.totalExclCents += r.totalExclCents;
    totals.vatCents += r.vatCents;
    for (const [k, b] of Object.entries(r.byDevice)) add(totals.byDevice, k, b.cents, b.n);
    for (const [k, b] of Object.entries(r.byMethod)) add(totals.byMethod, k, b.cents, b.n);
    for (const [k, b] of Object.entries(r.bySeller)) add(totals.bySeller, k, b.cents, b.n);
    for (const [k, b] of Object.entries(r.byService)) add(totals.byService, k, b.cents, b.n);
    for (const [k, t] of Object.entries(r.byTax)) {
      const x = (totals.byTax[k] ??= { inclCents: 0, exclCents: 0, taxCents: 0 });
      x.inclCents += t.inclCents;
      x.exclCents += t.exclCents;
      x.taxCents += t.taxCents;
    }
  }
  totals.clients = allCustomers.size; // distinct across the period, not a sum of days
  totals.avgInclCents = totals.tickets ? Math.round(totals.totalInclCents / totals.tickets) : 0;
  totals.avgExclCents = totals.tickets ? Math.round(totals.totalExclCents / totals.tickets) : 0;

  return { rows, totals, devices: deviceKeys, methods: methodKeys, taxes: taxKeys, sellers: sellerKeys, services: serviceKeys };
}

// ── The database half ────────────────────────────────────────────────────────
// Fetches (paged, so a long range can't silently truncate at PostgREST's 1000-row
// cap) and hands the raw rows to the pure core above.

export async function getDailySummary(from: string, to: string): Promise<DailySummary> {
  const sb = await createClient();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const docs = await fetchAllRows<any>(() =>
    sb
      .from("documents")
      .select("id, doc_type, business_day, total_incl, subtotal_excl, vat_total, customer_id, issued_by, cash_session_id")
      .in("doc_type", ["invoice", "credit_note"])
      .in("status", ["issued", "partly_paid", "paid"]) // drafts and VOIDs never count
      .gte("business_day", from)
      .lte("business_day", to),
  );

  if (docs.length === 0) {
    return buildDailySummary(from, to, {
      docs: [], payments: [], lines: [],
      sessionDevice: new Map(), deviceName: new Map(), sellerName: new Map(),
    });
  }

  const docIds = docs.map((d) => d.id);
  const sessionIds = [...new Set(docs.map((d) => d.cash_session_id).filter(Boolean))] as string[];
  const sellerIds = [...new Set(docs.map((d) => d.issued_by).filter(Boolean))] as string[];

  const [payments, lines, sessions, sellers, devices] = await Promise.all([
    fetchAllRows<any>(() => sb.from("payments").select("id, document_id, method, amount").in("document_id", docIds)),
    fetchAllRows<any>(() =>
      sb.from("document_lines").select("id, document_id, title, vat_rate, line_total_excl, line_vat, products(name, kind)").in("document_id", docIds),
    ),
    sessionIds.length ? fetchAllRows<any>(() => sb.from("cash_sessions").select("id, device_id").in("id", sessionIds)) : Promise.resolve([] as any[]),
    sellerIds.length ? fetchAllRows<any>(() => sb.from("app_users").select("id, display_name").in("id", sellerIds)) : Promise.resolve([] as any[]),
    fetchAllRows<any>(() => sb.from("devices").select("device_code, display_name")),
  ]);

  return buildDailySummary(from, to, {
    docs: docs as RawDoc[],
    payments: payments as RawPayment[],
    lines: lines as RawLine[],
    sessionDevice: new Map(sessions.map((s) => [s.id, s.device_id])),
    deviceName: new Map(devices.map((d) => [d.device_code, d.display_name || d.device_code])),
    sellerName: new Map(sellers.map((u) => [u.id, u.display_name || "—"])),
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
