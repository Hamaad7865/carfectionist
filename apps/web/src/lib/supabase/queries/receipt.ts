import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rupeesToCents, grossCents, presentLineDiscount, type DocLineRow } from "@/lib/money";
import { signBrandAssets } from "@/lib/pdf/assets";

/**
 * One sold line as the slip prints it: the UNDISCOUNTED unit price ("UP" column) beside the
 * amount the customer actually paid ("Total"), with the saving spelled out underneath.
 * Identical in meaning to the tablet's `ReceiptLine` (core/hardware/Hardware.kt) — the printed
 * slip and this card must stay the same document.
 */
export interface ReceiptLine {
  qty: number;
  title: string;
  /** FULL unit price, VAT-inclusive, BEFORE any line discount — the "UP" column. */
  unitInclCents: number;
  /** What this line adds to the bill: post-discount, VAT-inclusive — the "Total" column. */
  totalInclCents: number;
  /** qty × the full unit price, VAT-inclusive — the "Initial price" sub-line, and what Subtotal sums. */
  fullInclCents: number;
  /** What this line saved, VAT-inclusive. 0 = print no discount sub-lines at all. */
  discountInclCents: number;
  /** Set only for a percentage discount, so the slip can say "Discount 35.0% / 608.30". */
  discountPct: number;
  /** "35%" / "Rs 50.00 off" — null when the line carries no discount. */
  discountLabel: string | null;
  unitExclCents: number;  // HT — the A4 ticket shows both HT and TTC
  totalExclCents: number;
  vatRate: number;
}

/** A stored document_lines row, as much of it as the slip reads. */
export interface ReceiptLineRow extends DocLineRow {
  title: string;
  qty: number | string;
}

/**
 * One stored line → the slip's row.
 *
 * The saving comes from the STORED discount fields (via `presentLineDiscount`, shared with the
 * invoice PDF and the back-office screen), never from `full − charged`. VAT rounds once per
 * line, so that subtraction is a cent adrift on plenty of perfectly UNdiscounted lines and
 * would print a phantom "Initial price / Discount 0.01" beneath items nobody discounted. When
 * a line carries no stored discount its full price IS its charged price, by construction.
 */
export function receiptLineOf(l: ReceiptLineRow): ReceiptLine {
  const qty = Number(l.qty);
  const vatRate = Number(l.vat_rate ?? 15);
  const excl = rupeesToCents(Number(l.line_total_excl));
  const chargedIncl = excl + rupeesToCents(Number(l.line_vat));
  const unitExclCents = rupeesToCents(Number(l.unit_price));
  const disc = presentLineDiscount(l, true); // the slip quotes VAT-inclusive shelf prices
  return {
    qty,
    title: l.title,
    unitInclCents: grossCents(unitExclCents, vatRate),
    totalInclCents: chargedIncl,
    fullInclCents: disc?.fullAmountCents ?? chargedIncl,
    discountInclCents: disc?.savedCents ?? 0,
    discountPct: l.discount_kind === "amount" ? 0 : Number(l.discount_pct ?? 0),
    discountLabel: disc?.label ?? null,
    unitExclCents,
    totalExclCents: excl,
    vatRate,
  };
}

/**
 * The slip's totals rule, and the one thing on it the customer checks:
 *
 *   Subtotal = the lines at FULL price, VAT-inclusive (PRE-discount)
 *   Discount = Subtotal − Total
 *
 * Subtotal used to be the sum of the ALREADY-DISCOUNTED line amounts, which made Discount an
 * order-level residue: the reference sale printed "Subtotal 1550.45 / Discount 0.00" and the
 * customer never saw the 682.55 they had just saved. Taking the gap to the document's own TOTAL
 * absorbs per-line AND whole-basket discounts however they were stored, so the block always
 * foots. Same rule as the tablet (core/data/SaleReceipt.kt).
 */
export function receiptTotals(lines: ReceiptLine[], totalCents: number) {
  const subtotalInclCents = lines.reduce((s, l) => s + l.fullInclCents, 0);
  return { subtotalInclCents, discountInclCents: Math.max(0, subtotalInclCents - totalCents) };
}
export interface ReceiptVatGroup { rate: number; baseCents: number; vatCents: number; inclCents: number; }
/** One règlement row on the A4 ticket (reversals appear as negative rows). */
export interface ReceiptPaymentDetail { at: string; method: string; amountCents: number; isReversal: boolean; }

/**
 * One tender row on the slip: "2   CASH : 800.00Rs".
 *
 * [count] is how many legs of that method were taken — the leading digit on the reference
 * receipt. A reversal is never netted into the row it undoes: it gets its own
 * "1   CASH REVERSED : -800.00Rs" line, so the paper shows the money going back out instead
 * of a tender that quietly shrank.
 */
export interface ReceiptTender { method: string; count: number; amountCents: number; isReversal: boolean; }

export interface ReceiptData {
  studioName: string;
  /** Signed URL of the studio logo (brand-assets is private); null = none set. */
  logoUrl: string | null;
  address: string;
  brn: string;
  vatNo: string;
  phone: string;
  number: string | null;
  docLabel: string;      // "Invoice" | "Quote" | "Credit note"
  /** "Sale - SALES [CARFECTIONIST]" — the sale-mode line under the numbers. */
  saleModeLabel: string;
  /** "No. 11" — this sale's position within its till session; null = not rung on a till. */
  ticketNo: number | null;
  /** "Bill 1-N00000028" — the internal order reference; null = the row predates bill_no. */
  billLabel: string | null;
  /** "Appareil 1" — the ordinal of the terminal that rang it up; null = unknown, print nothing. */
  terminalNo: number | null;
  voided: boolean;
  isInvoice: boolean;
  dateTime: string;      // DD-MM-YYYY HH:MM:SS (thermal)
  dateLabel: string;     // "26 May 2026, 14:08" (card)
  cashier: string;
  customerName: string;
  customerEmail: string | null; // prefills the "email receipt" dialog
  /** The CLIENT's own fiscal identity — printed under their name for a business customer.
   *  Empty for a walk-in or an individual, who carry neither; the slip then omits the lines. */
  customerBrn: string;
  customerVatNo: string;
  lines: ReceiptLine[];
  subtotalInclCents: number;   // the lines at FULL price, VAT-inclusive (PRE-discount)
  subtotalCents: number;       // ex-VAT taxable base
  discountInclCents: number;   // Subtotal − Total: every discount, per-line and whole-basket
  vatCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  balanceDueCents: number;
  methodLabel: string;
  paid: boolean;
  vatGroups: ReceiptVatGroup[];
  payments: ReceiptTender[];
  paymentDetail: ReceiptPaymentDetail[];
  footerNote: string;
  barcodeValue: string;
  codeLabel: string;
  /** Points earned by THIS sale (the ledger's own 'earned' row for it — app.award_points_
   *  for_invoice, 20260811000030) — null unless the bill names a real customer. */
  pointsEarned: number | null;
  /** The customer's CURRENT points balance — the running total after this sale, same rule. */
  pointsBalanceAfter: number | null;
}

const METHOD_LABEL: Record<string, string> = { cash: "cash", card: "card", juice: "Juice", bank_transfer: "bank transfer" };
const METHOD_UPPER: Record<string, string> = { cash: "CASH", card: "CARD", juice: "JUICE", bank_transfer: "BANK TRANSFER" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_FOOTER = "Goods sold are not refundable. Thank you for shopping with us.";

function muDate(iso: string | null): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 4 * 3600_000); // Mauritius +04
}
const p2 = (x: number) => String(x).padStart(2, "0");

/**
 * "Appareil 1" — the terminal's position among the active tablets, oldest first.
 *
 * Null when the sale wasn't rung on a registered terminal: the web opens its own tills as
 * 'back-office', which is not in the device registry. The slip then omits the line rather than
 * inventing a number, exactly as the tablet does when it doesn't know.
 */
export function terminalNoOf(activeCodes: string[], deviceCode: string | null): number | null {
  if (!deviceCode) return null;
  const i = activeCodes.indexOf(deviceCode);
  return i >= 0 ? i + 1 : null;
}

/**
 * "Bill 1-N00000028" — the INTERNAL order reference, printed under the fiscal invoice number.
 * Not a fiscal series (documents.number is that), so it may gap. The terminal falls back to 1
 * when unknown; a row predating the bill_no column has nothing to print and the line is dropped.
 */
export function billReference(billNo: number | string | null | undefined, terminalNo: number | null): string | null {
  if (billNo == null || billNo === "") return null;
  return `Bill ${terminalNo ?? 1}-N${String(billNo).padStart(8, "0")}`;
}

/** A stored payments row, as much of it as the tender rows read. */
export interface ReceiptPaymentRow { method: string; amount: number | string; reverses_payment_id?: string | null }

/**
 * The slip's tender rows: one per METHOD, prefixed with how many legs of that kind were taken —
 * two cash legs plus a card read "2   CASH : 800.00Rs" then "1   CARD : 750.45Rs".
 *
 * A reversal is never netted into the row it undoes. Netting made a refunded tender look like a
 * smaller one that was never questioned; each reversal now gets its own row so the paper shows
 * the money going back out.
 */
export function receiptTenders(rows: ReceiptPaymentRow[]): ReceiptTender[] {
  const byMethod = new Map<string, { count: number; amountCents: number }>();
  const upper = (m: string) => METHOD_UPPER[m] ?? String(m).toUpperCase();
  for (const p of rows) {
    if (p.reverses_payment_id) continue;
    const m = upper(p.method);
    const g = byMethod.get(m) ?? { count: 0, amountCents: 0 };
    g.count += 1;
    g.amountCents += rupeesToCents(Number(p.amount));
    byMethod.set(m, g);
  }
  return [
    ...[...byMethod.entries()].map(([method, g]) => ({ method, count: g.count, amountCents: g.amountCents, isReversal: false })),
    ...rows
      .filter((p) => p.reverses_payment_id)
      .map((p) => ({ method: upper(p.method), count: 1, amountCents: rupeesToCents(Number(p.amount)), isReversal: true })),
  ];
}

/**
 * The tenant's active tablets, oldest first — the list whose 1-based index IS the "Appareil"
 * number ("TAB-84A1" → 1). Retired devices are left out, so the numbering matches the tablet's
 * and the Points-of-Sale grid, which both count active terminals only.
 *
 * Read with the SERVICE-ROLE client deliberately: `devices` is SELECT-able by owner/manager
 * only, and a receipt whose printed terminal number changed depending on who opened it would be
 * a defect. The registry is not sensitive here — that number is printed on the customer's copy
 * either way — and the read stays scoped to this document's own tenant.
 */
async function activeDeviceCodes(tenantId: string | null): Promise<string[]> {
  if (!tenantId) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await ((createAdminClient().from("devices" as any) as any)
      .select("device_code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("first_seen", { ascending: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => String(r.device_code));
  } catch {
    // No service-role key in this context — the Appareil line simply doesn't print.
    return [];
  }
}

/** RLS-scoped (staff pages). */
export async function getReceipt(id: string): Promise<ReceiptData | null> {
  const sb = await createClient();
  return getReceiptWith(sb, id);
}

/** Service-role (the PUBLIC /t/[token] ticket page — the HMAC token is the
 *  authorisation; never call without a verified token). */
export async function getReceiptPublic(id: string): Promise<ReceiptData | null> {
  return getReceiptWith(createAdminClient(), id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getReceiptWith(sb: any, id: string): Promise<ReceiptData | null> {
  const { data: doc } = await sb.from("documents").select("*, customers(name, email, brn, vat_number, points_balance)").eq("id", id).maybeSingle();
  if (!doc) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;

  const [{ data: lines }, { data: pays }, { data: bs }, { data: earnRow }] = await Promise.all([
    // unit_price + the discount columns: the slip prints the FULL unit price in its "UP" column
    // and names what each line saved, and both must come off the STORED discount.
    sb
      .from("document_lines")
      .select("qty, title, unit_price, line_total_excl, line_vat, vat_rate, discount_kind, discount_pct, discount_amount")
      .eq("document_id", id)
      .order("sort_order"),
    sb.from("payments").select("*").eq("document_id", id).order("received_at"),
    sb.from("business_settings").select("trading_name, address, brn, vat_number, phone, receipt_footer_text, receipt_logo_path").limit(1).maybeSingle(),
    // This document's own earn row, if any (award_points_for_invoice, 20260811000030) — at
    // most one exists (idx_points_ledger_one_earn_per_doc). Harmless to run even when the
    // bill names no customer; the result is only READ when it does, below.
    sb
      .from("customer_points_ledger")
      .select("delta")
      .eq("ref_type", "document")
      .eq("ref_id", id)
      .eq("reason", "earned")
      .maybeSingle(),
  ]);

  // The operator's name, and the slip's identity block: which sale of the till session this was
  // ("No. 11") and which terminal rang it up ("Appareil 1"). Both are unknown for a document
  // that never touched a till — the slip then simply omits those lines, exactly like the tablet.
  const [{ data: u }, ticketCount, { data: sess }, deviceCodes] = await Promise.all([
    d.created_by
      ? sb.from("app_users").select("display_name").eq("id", d.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    d.cash_session_id && d.issued_at
      ? sb
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("cash_session_id", d.cash_session_id)
          .lte("issued_at", d.issued_at)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((r: any) => (typeof r.count === "number" ? r.count : null))
      : Promise.resolve(null),
    d.cash_session_id
      ? sb.from("cash_sessions").select("device_id").eq("id", d.cash_session_id).maybeSingle()
      : Promise.resolve({ data: null }),
    activeDeviceCodes(d.tenant_id),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cashier = (((u as any)?.display_name ?? "") as string).replace(/\s*\(.*\)\s*$/, "").trim();
  const ticketNo = ticketCount && ticketCount > 0 ? ticketCount : null;

  // cash_sessions.device_id is the tablet's device_code; the terminal NUMBER is that device's
  // position among the active tablets, oldest first — TAB-84A1 → 1, TAB-66D2 → 2, matching the
  // tablet. The web opens its own tills as 'back-office', which is not a registered device: the
  // slip omits the Appareil line rather than inventing a number for it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceCode = ((sess as any)?.device_id ?? null) as string | null;
  const terminalNo = terminalNoOf(deviceCodes, deviceCode);
  const billLabel = billReference(d.bill_no, terminalNo);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = bs ?? {};
  // The bucket is private, so the card gets a fresh signed URL per render.
  const logoUrl = b.receipt_logo_path ? ((await signBrandAssets(sb, [b.receipt_logo_path]))[b.receipt_logo_path] ?? null) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rLines: ReceiptLine[] = ((lines ?? []) as any[]).map(receiptLineOf);

  const subtotalCents = rupeesToCents(Number(d.subtotal_excl));
  const vatCents = rupeesToCents(Number(d.vat_total));
  const totalCents = rupeesToCents(Number(d.total_incl));
  const { subtotalInclCents, discountInclCents } = receiptTotals(rLines, totalCents);

  let vatGroups: ReceiptVatGroup[] = Array.isArray(d.vat_breakdown)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (d.vat_breakdown as any[]).map((g) => {
        const base = rupeesToCents(Number(g.base));
        const vat = rupeesToCents(Number(g.vat));
        return { rate: Number(g.rate), baseCents: base, vatCents: vat, inclCents: base + vat };
      })
    : [];
  if (vatGroups.length === 0 && totalCents > 0) {
    // No fiscal snapshot (draft/legacy) — reconstruct groups from the real line
    // rates rather than assuming 15%.
    const byRate = new Map<number, { base: number; vat: number }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of (lines ?? []) as any[]) {
      const rate = Number(l.vat_rate ?? 15);
      const g = byRate.get(rate) ?? { base: 0, vat: 0 };
      g.base += rupeesToCents(Number(l.line_total_excl));
      g.vat += rupeesToCents(Number(l.line_vat));
      byRate.set(rate, g);
    }
    vatGroups = [...byRate.entries()].map(([rate, g]) => ({ rate, baseCents: g.base, vatCents: g.vat, inclCents: g.base + g.vat }));
    if (vatGroups.length === 0) vatGroups = [{ rate: 15, baseCents: subtotalCents, vatCents, inclCents: totalCents }];
  }

  // Net tenders by method so reversal/re-payment pairs collapse to what was taken.
  const payMap = new Map<string, number>();
  let changeCents = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payRows = (pays ?? []) as any[];
  const reversedIds = new Set(payRows.filter((p) => p.reverses_payment_id).map((p) => p.reverses_payment_id));
  for (const pmt of payRows) {
    const amt = rupeesToCents(Number(pmt.amount));
    payMap.set(pmt.method, (payMap.get(pmt.method) ?? 0) + amt);
    // Only count change from tenders that still stand (not a reversal, not reversed).
    if (!pmt.reverses_payment_id && !reversedIds.has(pmt.id)) {
      const chg = pmt.change_given != null ? rupeesToCents(Number(pmt.change_given)) : 0;
      if (chg > 0) changeCents += chg;
    }
  }
  const payments = receiptTenders(payRows);
  const paymentDetail: ReceiptPaymentDetail[] = payRows.map((pmt) => {
    const at = muDate(pmt.received_at);
    return {
      // Date + time, so a deposit taken earlier and the balance taken later are
      // each stamped when they happened (the owner's deposit breakdown).
      at: at ? `${p2(at.getUTCDate())}/${p2(at.getUTCMonth() + 1)}/${at.getUTCFullYear()} ${p2(at.getUTCHours())}:${p2(at.getUTCMinutes())}` : "",
      method: METHOD_UPPER[pmt.method] ?? String(pmt.method).toUpperCase(),
      amountCents: rupeesToCents(Number(pmt.amount)),
      isReversal: pmt.reverses_payment_id != null,
    };
  });
  const paidCents = [...payMap.values()].reduce((s, c) => s + Math.max(0, c), 0);
  const topMethod = [...payMap.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  const methodLabel = topMethod ? (METHOD_LABEL[topMethod] ?? topMethod) : "";
  const paid = d.status === "paid" || (totalCents > 0 && paidCents >= totalCents);
  const balanceDueCents = Math.max(0, totalCents - paidCents);

  const dt = muDate(d.issued_at ?? (d.issue_date ? `${d.issue_date}T00:00:00Z` : null) ?? d.created_at);
  const dateTime = dt ? `${p2(dt.getUTCDate())}-${p2(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}:${p2(dt.getUTCSeconds())}` : "";
  const dateLabel = dt ? `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}, ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}` : "";
  const ddmmyyyy = dt ? `${p2(dt.getUTCDate())}${p2(dt.getUTCMonth() + 1)}${dt.getUTCFullYear()}` : "";
  const barcodeValue = d.number ?? id.slice(0, 8).toUpperCase();
  const codeLabel = d.number ? `${d.number}${ddmmyyyy ? ` · ${ddmmyyyy}` : ""}` : barcodeValue;

  const studioName = b.trading_name ?? "Carfectionist";
  const docLabel = d.doc_type === "quote" ? "Quote" : d.doc_type === "credit_note" ? "Credit note" : "Invoice";

  // Points earned on this sale, and the customer's running balance after it — only when the
  // bill actually names one (mirrors getDocumentDetail's customerPointsBalance, same gate).
  const namesCustomer = d.customer_id != null;
  const pointsEarned = namesCustomer ? Number(earnRow?.delta ?? 0) : null;
  const pointsBalanceAfter = namesCustomer ? Number(d.customers?.points_balance ?? 0) : null;

  return {
    studioName,
    logoUrl,
    address: b.address ?? "",
    brn: b.brn ?? "",
    vatNo: b.vat_number ?? "",
    phone: b.phone ?? "",
    number: d.number,
    docLabel,
    // "Sale - SALES [CARFECTIONIST]", verbatim from the studio's own slip. A credit note is
    // not a sale, so it names itself instead of claiming to be one.
    saleModeLabel: `${d.doc_type === "invoice" ? "Sale" : docLabel} - SALES [${studioName.toUpperCase()}]`,
    ticketNo,
    billLabel,
    terminalNo,
    voided: d.status === "void",
    isInvoice: d.doc_type === "invoice",
    dateTime,
    dateLabel,
    cashier,
    // "Walk-in", not "Walk-in customer" — the tablet's slip prints exactly this, and the two
    // pieces of paper have to read the same.
    customerName: d.customers?.name ?? "Walk-in",
    customerEmail: d.customers?.email ?? null,
    // The frozen bill-to snapshot is the fiscal truth for an issued invoice; a not-yet-issued
    // draft/quote has no snapshot, so it falls back to the live customer record.
    customerBrn: String(d.bill_to_brn ?? d.customers?.brn ?? "").trim(),
    customerVatNo: String(d.bill_to_vat_number ?? d.customers?.vat_number ?? "").trim(),
    lines: rLines,
    subtotalInclCents,
    subtotalCents,
    discountInclCents,
    vatCents,
    totalCents,
    paidCents,
    changeCents,
    balanceDueCents,
    methodLabel,
    paid,
    vatGroups,
    payments,
    paymentDetail,
    footerNote: (b.receipt_footer_text && String(b.receipt_footer_text).trim()) || DEFAULT_FOOTER,
    barcodeValue,
    codeLabel,
    pointsEarned,
    pointsBalanceAfter,
  };
}
