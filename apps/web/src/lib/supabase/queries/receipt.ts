import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";

export interface ReceiptLine { qty: number; title: string; unitInclCents: number; totalInclCents: number; }
export interface ReceiptVatGroup { rate: number; baseCents: number; vatCents: number; inclCents: number; }

export interface ReceiptData {
  studioName: string;
  address: string;
  brn: string;
  vatNo: string;
  phone: string;
  number: string | null;
  docLabel: string;      // "Invoice" | "Quote" | "Credit note"
  voided: boolean;
  isInvoice: boolean;
  dateTime: string;      // DD-MM-YYYY HH:MM:SS (thermal)
  dateLabel: string;     // "26 May 2026, 14:08" (card)
  cashier: string;
  customerName: string;
  lines: ReceiptLine[];
  subtotalInclCents: number;   // sum of inclusive line totals, before order discount
  subtotalCents: number;       // ex-VAT taxable base
  discountInclCents: number;   // order discount (inclusive)
  vatCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  balanceDueCents: number;
  methodLabel: string;
  paid: boolean;
  vatGroups: ReceiptVatGroup[];
  payments: { method: string; amountCents: number }[];
  footerNote: string;
  barcodeValue: string;
  codeLabel: string;
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

export async function getReceipt(id: string): Promise<ReceiptData | null> {
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("*, customers(name)").eq("id", id).maybeSingle();
  if (!doc) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = doc;

  const [{ data: lines }, { data: pays }, { data: bs }] = await Promise.all([
    sb.from("document_lines").select("qty, title, line_total_excl, line_vat, vat_rate").eq("document_id", id).order("sort_order"),
    sb.from("payments").select("*").eq("document_id", id).order("received_at"),
    sb.from("business_settings").select("trading_name, address, brn, vat_number, phone, receipt_footer_text").limit(1).maybeSingle(),
  ]);

  let cashier = "";
  if (d.created_by) {
    const { data: u } = await sb.from("app_users").select("display_name").eq("id", d.created_by).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cashier = (((u as any)?.display_name ?? "") as string).replace(/\s*\(.*\)\s*$/, "").trim();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = bs ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rLines: ReceiptLine[] = ((lines ?? []) as any[]).map((l) => {
    const qty = Number(l.qty);
    const incl = rupeesToCents(Number(l.line_total_excl)) + rupeesToCents(Number(l.line_vat));
    return { qty, title: l.title, unitInclCents: qty ? Math.round(incl / qty) : incl, totalInclCents: incl };
  });

  const subtotalCents = rupeesToCents(Number(d.subtotal_excl));
  const vatCents = rupeesToCents(Number(d.vat_total));
  const totalCents = rupeesToCents(Number(d.total_incl));
  const subtotalInclCents = rLines.reduce((s, l) => s + l.totalInclCents, 0);
  const discountInclCents = Math.max(0, subtotalInclCents - totalCents);

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
  const payments = [...payMap.entries()].filter(([, c]) => c > 0).map(([m, c]) => ({ method: METHOD_UPPER[m] ?? m.toUpperCase(), amountCents: c }));
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

  return {
    studioName: b.trading_name ?? "Carfectionist",
    address: b.address ?? "",
    brn: b.brn ?? "",
    vatNo: b.vat_number ?? "",
    phone: b.phone ?? "",
    number: d.number,
    docLabel: d.doc_type === "quote" ? "Quote" : d.doc_type === "credit_note" ? "Credit note" : "Invoice",
    voided: d.status === "void",
    isInvoice: d.doc_type === "invoice",
    dateTime,
    dateLabel,
    cashier,
    customerName: d.customers?.name ?? "Walk-in customer",
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
    footerNote: (b.receipt_footer_text && String(b.receipt_footer_text).trim()) || DEFAULT_FOOTER,
    barcodeValue,
    codeLabel,
  };
}
