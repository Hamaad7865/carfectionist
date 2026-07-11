import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { muDate, muDateTime } from "@/lib/mu-date";

// ─── Tickets view (Cashmag "invoice history") ────────────────────────────────
// One row per issued invoice / credit note in the period. Credit notes are the
// negative rows ("Cancel" in Cashmag); voided invoices carry a Void label.

export interface TicketRow {
  id: string;
  number: string | null;
  docType: string; // invoice | credit_note
  status: string;
  cancelLabel: "Cancel" | "Void" | null;
  date: string;  // MU yyyy-mm-dd
  hour: string;  // MU HH:MM
  jobId: string | null; // Order / Booking
  serviceCount: number; // lines on the ticket
  exclCents: number;    // negative for credit notes
  inclCents: number;
  customer: string | null;
}

export interface TicketsData {
  rows: TicketRow[];
  count: number;
  totalExclCents: number;
  totalInclCents: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getTickets(fromP?: string, toP?: string): Promise<TicketsData> {
  const sb = await createClient();
  const from = fromP && DATE_RE.test(fromP) ? fromP : undefined;
  const to = toP && DATE_RE.test(toP) ? toP : undefined;

  let q = sb
    .from("documents")
    .select("id, number, doc_type, status, issued_at, job_id, total_incl, subtotal_excl, source_document_id, customers(name)")
    .in("doc_type", ["invoice", "credit_note"])
    .neq("status", "draft")
    .order("issued_at", { ascending: false })
    .limit(500);
  if (from) q = q.gte("issued_at", `${from}T00:00:00+04:00`);
  if (to) q = q.lt("issued_at", new Date(Date.parse(`${to}T00:00:00+04:00`) + 24 * 3600_000).toISOString());

  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = (data ?? []) as any[];

  // Line counts in one query (the "Service" column).
  const ids = docs.map((d) => d.id);
  const countByDoc = new Map<string, number>();
  if (ids.length > 0) {
    const { data: lines } = await sb.from("document_lines").select("document_id").in("document_id", ids).limit(5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of (lines ?? []) as any[]) countByDoc.set(l.document_id, (countByDoc.get(l.document_id) ?? 0) + 1);
  }

  const rows: TicketRow[] = docs.map((d) => {
    const isCN = d.doc_type === "credit_note";
    const sign = isCN ? -1 : 1;
    const at = d.issued_at as string | null;
    return {
      id: d.id,
      number: d.number,
      docType: d.doc_type,
      status: d.status,
      cancelLabel: isCN ? "Cancel" : d.status === "void" ? "Void" : null,
      date: at ? muDate(at) : "—",
      hour: at ? muDateTime(at).slice(11) : "—",
      jobId: d.job_id ?? null,
      serviceCount: countByDoc.get(d.id) ?? 0,
      exclCents: sign * rupeesToCents(Number(d.subtotal_excl)),
      inclCents: sign * rupeesToCents(Number(d.total_incl)),
      customer: d.customers?.name ?? null,
    };
  });

  // Voided invoices are informational, not revenue — exclude them from totals.
  const counted = rows.filter((r) => r.status !== "void");
  return {
    rows,
    count: rows.length,
    totalExclCents: counted.reduce((s, r) => s + r.exclCents, 0),
    totalInclCents: counted.reduce((s, r) => s + r.inclCents, 0),
  };
}
