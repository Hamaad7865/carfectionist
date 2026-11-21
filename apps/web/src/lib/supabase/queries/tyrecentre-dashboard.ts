import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { rupeesToCents } from "@/lib/money";
import { bucketByDay, muDayKeys } from "@/features/tyrecentre/dashboard-series";

export interface TyreDashboardSeries {
  /** Mauritius days, oldest first ("yyyy-mm-dd"). */
  days: string[];
  /** Issued sales incl. VAT per day — invoices, less credit notes. */
  salesCents: number[];
  invoiceCount: number[];
  /** Money received per day (a reversal counts against its day). */
  collectedCents: number[];
}

/** 90 days shown, plus the 90 before them for the "vs the period before" comparison. */
export const SERIES_DAYS = 180;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** The tyre-centre dashboard's daily figures for the last 180 days. RLS-scoped; the same
 *  document statuses the sales-performance chart counts as sales. */
export async function getTyreDashboardSeries(nowMs = Date.now()): Promise<TyreDashboardSeries> {
  const sb = await createClient();
  const days = muDayKeys(nowMs, SERIES_DAYS);
  // Midnight Mauritius (UTC+4) of the first day, as an instant.
  const since = new Date(Date.parse(`${days[0]}T00:00:00+04:00`)).toISOString();
  const [docs, pays] = await Promise.all([
    fetchAllRows<Row>(() =>
      sb
        .from("documents")
        .select("id, doc_type, total_incl, issued_at")
        .in("doc_type", ["invoice", "credit_note"])
        .in("status", ["issued", "partly_paid", "paid"])
        .gte("issued_at", since),
    ),
    fetchAllRows<Row>(() => sb.from("payments").select("id, amount, received_at").gte("received_at", since)),
  ]);
  const signed = (d: Row) => (d.doc_type === "credit_note" ? -1 : 1) * rupeesToCents(Number(d.total_incl));
  return {
    days,
    salesCents: bucketByDay(days, docs.map((d) => ({ at: d.issued_at, value: signed(d) }))),
    invoiceCount: bucketByDay(days, docs.filter((d) => d.doc_type === "invoice").map((d) => ({ at: d.issued_at, value: 1 }))),
    collectedCents: bucketByDay(days, pays.map((p) => ({ at: p.received_at, value: rupeesToCents(Number(p.amount)) }))),
  };
}
