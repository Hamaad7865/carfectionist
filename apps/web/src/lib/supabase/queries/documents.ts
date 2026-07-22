import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { methodLabelFor } from "@/lib/method-label";

export interface DocFilters {
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  customer?: string;
  /** "archived" shows only the tidied-away paperwork; anything else = the working list. */
  view?: string;
}

export interface DocListRow {
  id: string;
  doc_type: string;
  status: string;
  number: string | null;
  issue_date: string | null;
  created_at: string;
  total_incl: string;
  amount_paid: string;
  customerName: string | null;
  methodLabel: string;
  hasDiscount: boolean;
  comment: string | null;
  voidReason: string | null;
  /** Why this row is in the archive — shown as a chip in the archived view. */
  archivedReason: string | null;
}

export interface DocList {
  rows: DocListRow[]; // display slice (capped)
  count: number; // total matching, uncapped
  totalCents: number; // grand total over ALL matching, uncapped
}

/** Documents list (quotes + invoices + credit notes), RLS-scoped, filtered. The
 *  displayed rows are capped, but count + totalCents are computed uncapped so the
 *  footer figures are correct beyond the display cap. */
export async function listDocuments(f: DocFilters): Promise<DocList> {
  const sb = await createClient();
  const hasCustomer = !!f.customer?.trim();
  const rel = hasCustomer ? "customers!inner(name)" : "customers(name)";
  const archivedView = f.view === "archived";

  // An invoice reversed by a LIVE credit note is finished business. Resolved
  // here because PostgREST can't express "id in (subquery)"; it's one small
  // column and credit notes are rare.
  const { data: cnRows } = await sb
    .from("documents")
    .select("source_document_id")
    .eq("doc_type", "credit_note")
    .neq("status", "void")
    .not("source_document_id", "is", null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creditedSet = new Set(((cnRows ?? []) as any[]).map((r) => r.source_document_id as string));

  // A quote whose car never got worked on is dead too. cancel_job resolves the
  // BILL (void / credit note) but leaves the quote sitting there "Accepted",
  // which is how a cancelled job kept a live-looking row in the working list.
  // A quote counts as dead only when every job it produced was cancelled — one
  // re-booked after a cancellation is live business again.
  const { data: jobRows } = await sb.from("jobs").select("id, status, source_quote_id");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jobs = (jobRows ?? []) as any[];
  const cancelledJobIds = jobs.filter((j) => j.status === "cancelled").map((j) => j.id as string);
  const liveQuoteIds = new Set(
    jobs.filter((j) => j.status !== "cancelled" && j.source_quote_id).map((j) => j.source_quote_id as string),
  );
  // Two ways a quote reaches its job: the job points back (source_quote_id), or
  // the quote points forward (documents.job_id). Honour both.
  const { data: byJobId } = cancelledJobIds.length
    ? await sb.from("documents").select("id").eq("doc_type", "quote").in("job_id", cancelledJobIds)
    : { data: [] };
  const deadQuoteSet = new Set(
    [
      ...jobs.filter((j) => j.status === "cancelled" && j.source_quote_id).map((j) => j.source_quote_id as string),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((byJobId ?? []) as any[]).map((d) => d.id as string),
    ].filter((id) => !liveQuoteIds.has(id)),
  );

  // Both sets end up as one "id in (…)" filter; kept apart for the reason chip.
  const archivedIds = [...new Set([...creditedSet, ...deadQuoteSet])];

  // A document is archived when it is dead paperwork — void, the credit note
  // that killed a bill, the invoice that credit note reversed, a quote the
  // customer declined or that expired — or when a human filed it away. Derived
  // rather than stamped, so a status change tidies itself with no backfill.
  const DEAD_QUOTE = "and(doc_type.eq.quote,status.in.(declined,expired))";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyScope = (q: any) => {
    if (archivedView) {
      const ors = ["archived_at.not.is.null", "status.eq.void", "doc_type.eq.credit_note", DEAD_QUOTE];
      if (archivedIds.length) ors.push(`id.in.(${archivedIds.join(",")})`);
      return q.or(ors.join(","));
    }
    q = q
      .is("archived_at", null)
      .neq("status", "void")
      .neq("doc_type", "credit_note")
      .or("doc_type.neq.quote,status.not.in.(declined,expired)");
    if (archivedIds.length) q = q.not("id", "in", `(${archivedIds.join(",")})`);
    return q;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    q = applyScope(q);
    if (f.type) q = q.eq("doc_type", f.type);
    if (f.status) q = q.eq("status", f.status);
    if (f.from) q = q.gte("created_at", f.from);
    if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999+04:00`);
    if (hasCustomer) q = q.ilike("customers.name", `%${f.customer!.trim()}%`);
    return q;
  };

  const listQ = applyFilters(
    sb
      .from("documents")
      .select(`id, doc_type, status, number, issue_date, created_at, total_incl, amount_paid, discount_kind, discount_value, comment, void_reason, archived_at, payments(method, amount), ${rel}`)
      .order("created_at", { ascending: false })
      .limit(200),
  );
  // Uncapped footer aggregation — one numeric column, paged past the PostgREST
  // 1000-row cap (+ inner join only when filtering by customer).
  const makeTotQ = () => applyFilters(sb.from("documents").select(hasCustomer ? "total_incl, customers!inner(name)" : "total_incl"));

  const [listRes, totArr] = await Promise.all([listQ, fetchAllRows(makeTotQ)]);
  if (listRes.error) throw new Error(listRes.error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((listRes.data ?? []) as any[]).map((d) => {
    const methodLabel = methodLabelFor((d.payments ?? []) as { method: string; amount?: number | string }[]);
    return {
      id: d.id,
      doc_type: d.doc_type,
      status: d.status,
      number: d.number,
      issue_date: d.issue_date,
      created_at: d.created_at,
      total_incl: d.total_incl,
      amount_paid: d.amount_paid,
      customerName: d.customers?.name ?? null,
      methodLabel,
      hasDiscount: d.discount_kind != null && Number(d.discount_value) > 0,
      comment: d.comment ?? null,
      voidReason: d.status === "void" ? (d.void_reason ?? null) : null,
      archivedReason: !archivedView
        ? null
        : d.status === "void"
          ? "Voided"
          : d.doc_type === "credit_note"
            ? "Credit note"
            : creditedSet.has(d.id)
              ? "Credited"
              : deadQuoteSet.has(d.id)
                ? "Job cancelled"
                : d.doc_type === "quote" && d.status === "declined"
                ? "Declined"
                : d.doc_type === "quote" && d.status === "expired"
                  ? "Expired"
                  : "Archived",
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalCents = (totArr as any[]).reduce((s, d) => s + Math.round(Number(d.total_incl) * 100), 0);
  return { rows, count: totArr.length, totalCents };
}
