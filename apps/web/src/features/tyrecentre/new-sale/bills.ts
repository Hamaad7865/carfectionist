import { computeTotals, type Allowance, type DocumentTotals } from "@/lib/money";
import type { SaleCompany } from "@/lib/supabase/queries/tyrecentre-sale";
import { basketAllowance, discountBlockReason, type Basket, type CartLine, type DiscountKind } from "@/features/counter/settle";

/** One company's bill discount (tyre centre, owner rule 2026-11-22: discounts are per company).
 *  value: percent → %, amount → VAT-inclusive cents — the same units as the basket's own. */
export interface CompanyDiscount {
  kind: DiscountKind | null;
  value: number;
  reason: string;
  /** An owner's PIN approval, recorded against this company's bill id. */
  approvedMaxCents: number | null;
}

export const NO_DISCOUNT: CompanyDiscount = { kind: null, value: 0, reason: "", approvedMaxCents: null };

/** One invoice of the sale, as the till shows it before charging. */
export interface Bill {
  company: SaleCompany;
  /** The company's place in the shop's sort order — its colour, and its invoice's place. */
  index: number;
  lines: CartLine[];
  totals: DocumentTotals;
  allowance: Allowance;
  blockReason: string | null;
  discount: CompanyDiscount;
}

/** Which company sells a line: the product's own, else the shop's main company — the same rule
 *  the database stamps lines with (app.lines_stamp_entity). */
export function companyIdOf(line: CartLine, companies: SaleCompany[]): string | null {
  const main = companies.find((c) => c.isDefault) ?? companies[0];
  const own = line.product.legalEntityId ?? null;
  return own && companies.some((c) => c.id === own) ? own : (main?.id ?? null);
}

/** The sale as one bill per company, in the shop's company order (the order issue_checkout
 *  issues them). A shop with one company gets one bill carrying the basket's own discount —
 *  exactly the single-invoice sale it always was. A company with nothing in the cart has no bill. */
export function billsOf(
  basket: Basket,
  companies: SaleCompany[],
  discounts: Record<string, CompanyDiscount>,
  carwashPct: number,
): Bill[] {
  if (basket.lines.length === 0) return [];
  const several = companies.length > 1;
  const groups = new Map<string, CartLine[]>();
  for (const l of basket.lines) {
    const id = companyIdOf(l, companies) ?? "";
    groups.set(id, [...(groups.get(id) ?? []), l]);
  }
  const ordered = companies.length ? companies : [{ id: "", name: "", vatRegistered: true, vatRate: 15, isDefault: true }];
  return ordered.flatMap((company, index) => {
    const lines = groups.get(company.id);
    if (!lines?.length) return [];
    const discount: CompanyDiscount = several
      ? (discounts[company.id] ?? NO_DISCOUNT)
      : { kind: basket.orderDiscKind, value: basket.orderDiscValue, reason: basket.orderDiscReason, approvedMaxCents: basket.approvedMaxCents };
    // The basket's own rules, run on this company's lines with this company's discount — the
    // database checks each bill on its own inside issue_document, so the till must too.
    const sub: Basket = {
      ...basket,
      lines,
      orderDiscKind: discount.kind,
      orderDiscValue: discount.value,
      orderDiscReason: discount.reason,
      approvedMaxCents: discount.approvedMaxCents,
    };
    const totals = computeTotals(
      lines.map((l) => ({
        qty: l.qty,
        unitCents: l.product.priceCents,
        discountPct: l.discountPct,
        discountKind: l.discountKind,
        discountAmountCents: l.discountAmountCents,
        vatRatePct: l.product.vatRate,
        priceInclusive: l.product.priceIncludesVat,
      })),
      discount.kind ? { kind: discount.kind, value: discount.value } : null,
    );
    return [{
      company,
      index,
      lines,
      totals,
      allowance: basketAllowance(sub, carwashPct),
      blockReason: discountBlockReason(sub, carwashPct),
      discount,
    }];
  });
}

/** The sale's single figure: what the customer pays, every company's bill together. */
export const grandTotalCents = (bills: Bill[]) => bills.reduce((s, b) => s + b.totals.totalCents, 0);

/** Why the sale can't be charged yet, naming the company when there are two bills. */
export function billsBlockReason(bills: Bill[]): string | null {
  const blocked = bills.find((b) => b.blockReason);
  if (!blocked) return null;
  return bills.length > 1 ? `${blocked.company.name}: ${blocked.blockReason}` : blocked.blockReason;
}

/** What counterSaleAction takes for a two-company sale: each company's discount. */
export function companyDiscountsPayload(bills: Bill[]) {
  return bills
    .filter((b) => b.discount.kind && b.discount.value > 0)
    .map((b) => ({ legalEntityId: b.company.id, kind: b.discount.kind!, value: b.discount.value, reason: b.discount.reason.trim() || undefined }));
}
