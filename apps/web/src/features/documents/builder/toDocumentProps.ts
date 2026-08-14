import { computeTotals, formatMUR, netFromGrossCents } from "@/lib/money";
import type { DocumentA4Props } from "@/components/pdf/DocumentA4";
import type { DocAssets } from "@/lib/pdf/assets";
import type { BuilderState } from "./state";

export interface BuilderBusiness {
  tradingName: string;
  legalName: string;
  country: string;
  brn: string;
  email: string;
  phone: string;
  vatNo: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
}

export interface PreviewOpts {
  createdBy: string;
  customerName: string;
  customerCountry: string;
  /** A business client's own fiscal numbers, previewed under their name. Empty for an individual. */
  customerBrn?: string;
  customerVatNo?: string;
  terms: string[];
  issueDate?: string | null;
  number?: string | null;
  assets?: DocAssets;
}

/** Pure map from builder state → DocumentA4 props (drives the live preview and,
 *  later, the PDF). Totals come from the shared cents math. */
export function toDocumentProps(
  state: BuilderState,
  business: BuilderBusiness,
  opts: PreviewOpts,
): DocumentA4Props {
  const totals = computeTotals(
    // priceInclusive MUST ride along: a gross-quoting line stores its unit as the exact gross
    // with the flag set, and without it computeLineTotals would treat that gross as NET and add
    // VAT again — inflating the printed A4 rate, amount, VAT and total by the VAT factor.
    state.lines.map((l) => ({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.vatRatePct, priceInclusive: l.priceInclusive })),
    state.docDiscountKind ? { kind: state.docDiscountKind, value: state.docDiscountValue } : null,
  );
  const lines = state.lines.map((l, i) => ({
    title: l.title || "—",
    detail: l.description || null,
    rich: l.rich ?? null,
    unit: l.unitLabel?.trim() || null,
    qty: l.qty,
    // Ex-VAT presentation (owner decision, 2026-08-14): the Rate is the taxable price and VAT
    // is its own totals row. A priceInclusive line's unitCents IS the typed shelf gross, so its
    // rate is backed out at the line's own rate; an unflagged unit is already net. The Amount
    // stays the ledger's excl figure so the column foots to the TOTAL — the typed gross.
    rateCents: l.priceInclusive ? netFromGrossCents(l.unitCents, l.vatRatePct) : l.unitCents,
    amountCents: totals.lines[i].exclCents,
    discountNote:
      l.discountKind === "amount" && l.discountAmountCents > 0 ? `less ${formatMUR(l.discountAmountCents)}`
      : (l.discountPct ?? 0) > 0 ? `less ${l.discountPct}%`
      : null,
  }));
  const orderDiscountExclCents = totals.grossSubtotalCents - totals.subtotalCents;
  const orderDiscountLabel =
    state.docDiscountKind === "percent" ? `${state.docDiscountValue}%`
    : state.docDiscountKind === "amount" ? `${formatMUR(state.docDiscountValue)} incl. VAT`
    : null;

  return {
    docType: state.docType,
    number: opts.number ?? state.number,
    issueDate: opts.issueDate ?? null,
    createdBy: opts.createdBy,
    from: {
      tradingName: business.tradingName,
      legalName: business.legalName,
      country: business.country,
      brn: business.brn,
      email: business.email,
      phone: business.phone,
      vatNo: business.vatNo,
    },
    billTo: { name: opts.customerName, country: opts.customerCountry, brn: opts.customerBrn ?? "", vatNo: opts.customerVatNo ?? "" },
    lines,
    subtotalCents: totals.grossSubtotalCents,
    discountCents: orderDiscountExclCents > 0 ? orderDiscountExclCents : undefined,
    discountLabel: orderDiscountExclCents > 0 ? orderDiscountLabel : undefined,
    vatCents: totals.vatCents,
    totalCents: totals.totalCents,
    bank: {
      accountName: business.bankAccountName,
      accountNumber: business.bankAccountNumber,
      bankName: business.bankName,
    },
    terms: opts.terms,
    assets: opts.assets,
    sectionConfig: state.sectionConfig,
    customFields: (state.customFields ?? []).filter((f) => f.label.trim() !== ""),
  };
}
