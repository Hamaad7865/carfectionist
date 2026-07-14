// Which quote, and which invoice, belongs on a job's row.
//
// This is fiddlier than it looks, and getting it wrong shows the owner the wrong
// money:
//   • documents.job_id is stamped on the QUOTE and on CREDIT NOTES too, not just
//     the invoice — so "the doc with this job_id" is not "the invoice".
//   • a job can carry several quotes (revisions) and several invoices (one voided,
//     one reissued). The live one is the latest NON-VOID.
//   • if every invoice was voided, say so with a void pill rather than claiming the
//     job was never invoiced — silence would read as "nothing to collect".
// Pure functions, so these rules are pinned by tests.

export interface RawDoc {
  id: string;
  doc_type: string; // quote | invoice | credit_note
  status: string;
  number: string | null;
  total_incl: string | number;
  amount_paid: string | number;
  created_at: string;
}

export interface JobDoc {
  id: string;
  docType: string;
  status: string;
  number: string | null;
  totalCents: number;
  outstandingCents: number;
}

/** An invoice still owes money only while it is live — a void, draft or paid one owes nothing. */
export const isCollectible = (d: { doc_type: string; status: string }): boolean =>
  d.doc_type === "invoice" && (d.status === "issued" || d.status === "partly_paid");

const newest = (docs: RawDoc[]): RawDoc | null =>
  docs.reduce<RawDoc | null>((best, d) => (best === null || d.created_at > best.created_at ? d : best), null);

/** The live document of this type, or — if they were all voided — the last void one. */
export function pickDoc(docs: RawDoc[], type: "quote" | "invoice"): RawDoc | null {
  const mine = docs.filter((d) => d.doc_type === type);
  return newest(mine.filter((d) => d.status !== "void")) ?? newest(mine);
}

/**
 * THE quote of a job is the one it was created from — jobs.source_quote_id — even when a
 * later quote for the same car also carries this job_id (it happens: quote A00003 is
 * accepted into the job, then A00006 is raised against it). "Newest wins" would show the
 * unaccepted straggler as the job's quote. Only when the job has no source quote (a
 * walk-in, or a job made before that link was recorded) do we fall back to the newest.
 */
export function pickQuote(docs: RawDoc[], sourceQuoteId: string | null): RawDoc | null {
  const source = sourceQuoteId ? docs.find((d) => d.id === sourceQuoteId && d.doc_type === "quote") : undefined;
  return source ?? pickDoc(docs, "quote");
}

/** Live (non-void) invoices on the job — what the outstanding total is summed over. */
export const liveInvoices = (docs: RawDoc[]): RawDoc[] =>
  docs.filter((d) => d.doc_type === "invoice" && d.status !== "void");

/** PostgREST hands numerics back as strings; cents keep the arithmetic exact. */
const cents = (v: string | number): number => Math.round(Number(v) * 100);

export function toJobDoc(d: RawDoc): JobDoc {
  const totalCents = cents(d.total_incl);
  return {
    id: d.id,
    docType: d.doc_type,
    status: d.status,
    number: d.number,
    totalCents,
    outstandingCents: isCollectible(d) ? Math.max(0, totalCents - cents(d.amount_paid)) : 0,
  };
}

/** What the customer still owes on this job, across every live invoice. */
export const outstandingCents = (docs: RawDoc[]): number =>
  liveInvoices(docs).reduce((sum, d) => sum + toJobDoc(d).outstandingCents, 0);
