import { computeTotals, formatMUR, grossCents } from "@/lib/money";
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
  terms: string[];
  issueDate?: string | null;
  number?: string | null;
  assets?: DocAssets;
  /** Shop quotes VAT-inclusive shelf prices — preview them the way the PDF will print them. */
  pricesInclVat?: boolean;
}

/** Pure map from builder state → DocumentA4 props (drives the live preview and,
 *  later, the PDF). Totals come from the shared cents math. */
export function toDocumentProps(
  state: BuilderState,
  business: BuilderBusiness,
  opts: PreviewOpts,
): DocumentA4Props {
  const totals = computeTotals(
    state.lines.map((l) => ({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.vatRatePct })),
    state.docDiscountKind ? { kind: state.docDiscountKind, value: state.docDiscountValue } : null,
  );
  const lines = state.lines.map((l, i) => ({
    title: l.title || "—",
    detail: l.description || null,
    qty: l.qty,
    rateCents: opts.pricesInclVat ? grossCents(l.unitCents, l.vatRatePct) : l.unitCents,
    amountCents: opts.pricesInclVat
      ? totals.lines[i].exclCents + totals.lines[i].vatCents
      : totals.lines[i].exclCents,
    discountNote:
      l.discountKind === "amount" && l.discountAmountCents > 0 ? `less ${formatMUR(l.discountAmountCents)}`
      : (l.discountPct ?? 0) > 0 ? `less ${l.discountPct}%`
      : null,
  }));
  const orderDiscountExclCents = totals.grossSubtotalCents - totals.subtotalCents;
  const subtotalInclCents = totals.lines.reduce((s, l) => s + l.exclCents + l.vatCents, 0);
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
    billTo: { name: opts.customerName, country: opts.customerCountry },
    lines,
    subtotalCents: opts.pricesInclVat ? subtotalInclCents : totals.grossSubtotalCents,
    discountCents: opts.pricesInclVat
      ? (subtotalInclCents - totals.totalCents > 0 ? subtotalInclCents - totals.totalCents : undefined)
      : (orderDiscountExclCents > 0 ? orderDiscountExclCents : undefined),
    vatInclusive: opts.pricesInclVat,
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
