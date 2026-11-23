import { rupeesToCents } from "@/lib/money";

/** An issuing company as the dashboard names it. */
export interface DashCompany {
  id: string;
  name: string;
  isDefault: boolean;
  vatRegistered: boolean;
}

/** One company's headline figures — the same four tiles, for its own bills only. */
export interface CompanyFigures extends DashCompany {
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
  invoiceCount: number;
}

type Doc = {
  id: string;
  doc_type: string;
  total_incl: number | string;
  amount_paid: number | string;
  source_document_id: string | null;
  legal_entity_id?: string | null;
};
type Pay = { amount: number | string; documents?: { legal_entity_id?: string | null } | null };

/**
 * The dashboard's four headline figures, per issuing company (the tyre centre: the VAT tyre
 * company and the VAT-exempt service company). Same rules as the shop-wide tiles — credit notes
 * net off Invoiced, a fully credited invoice owes nothing, payments are signed — and a bill or
 * payment with no company stored is the default company's. The rows add up to the shop totals.
 * Null for a shop with one company: the dashboard then shows no split.
 */
export function splitByCompany(docs: Doc[], pays: Pay[], companies: DashCompany[]): CompanyFigures[] | null {
  if (companies.length < 2) return null;
  const fallback = (companies.find((c) => c.isDefault) ?? companies[0]).id;
  const known = new Set(companies.map((c) => c.id));
  const of = (id: string | null | undefined) => (id && known.has(id) ? id : fallback);
  const rows = new Map(
    companies.map((c) => [c.id, { ...c, invoicedCents: 0, collectedCents: 0, outstandingCents: 0, invoiceCount: 0 }]),
  );
  const credited = new Set(
    docs.filter((d) => d.doc_type === "credit_note" && d.source_document_id).map((d) => d.source_document_id),
  );
  for (const d of docs) {
    const r = rows.get(of(d.legal_entity_id))!;
    const total = rupeesToCents(Number(d.total_incl));
    if (d.doc_type === "invoice") {
      r.invoicedCents += total;
      r.invoiceCount += 1;
      if (!credited.has(d.id)) r.outstandingCents += rupeesToCents(Number(d.total_incl) - Number(d.amount_paid));
    } else {
      r.invoicedCents -= total;
    }
  }
  for (const p of pays) rows.get(of(p.documents?.legal_entity_id))!.collectedCents += rupeesToCents(Number(p.amount));
  return [...rows.values()];
}
