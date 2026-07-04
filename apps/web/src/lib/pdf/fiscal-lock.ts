/**
 * Fiscal lock. Quotes are free-form; invoices (and credit notes) must always
 * show the legal identity, the VAT/total block, and the amount in words — these
 * can never be hidden by template config. The renderer consumes only the
 * resolved flags, so no template setting can accidentally drop a legal field.
 */
export interface SectionFlags {
  from: boolean; // legal identity box (legal name, BRN, VAT no…)
  vatBreakdown: boolean; // VAT + Total (MUR) block
  totalInWords: boolean;
  bankDetails: boolean;
  terms: boolean;
  signature: boolean;
  footerBanner: boolean;
}

export type DocType = "quote" | "invoice" | "credit_note";

const DEFAULTS: SectionFlags = {
  from: true,
  vatBreakdown: true,
  totalInWords: true,
  bankDetails: true,
  terms: true,
  signature: false,
  footerBanner: true,
};

// Forced visible on invoices/credit notes regardless of config.
const INVOICE_LOCKED: (keyof SectionFlags)[] = ["from", "vatBreakdown", "totalInWords"];

export function effectiveSections(config: Partial<SectionFlags>, docType: DocType): SectionFlags {
  const merged: SectionFlags = { ...DEFAULTS, ...config };
  if (docType === "invoice" || docType === "credit_note") {
    for (const key of INVOICE_LOCKED) merged[key] = true;
  }
  return merged;
}

/** True when a section toggle is locked (for greying it out in the UI). */
export function isSectionLocked(key: keyof SectionFlags, docType: DocType): boolean {
  return (docType === "invoice" || docType === "credit_note") && INVOICE_LOCKED.includes(key);
}
