import { computeTotals } from "@/lib/money";
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
}

/** Pure map from builder state → DocumentA4 props (drives the live preview and,
 *  later, the PDF). Totals come from the shared cents math. */
export function toDocumentProps(
  state: BuilderState,
  business: BuilderBusiness,
  opts: PreviewOpts,
): DocumentA4Props {
  const totals = computeTotals(
    state.lines.map((l) => ({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, vatRatePct: l.vatRatePct })),
  );
  const lines = state.lines.map((l, i) => ({
    title: l.title || "—",
    detail: l.description || null,
    qty: l.qty,
    rateCents: l.unitCents,
    amountCents: totals.lines[i].exclCents,
  }));

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
    subtotalCents: totals.subtotalCents,
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
