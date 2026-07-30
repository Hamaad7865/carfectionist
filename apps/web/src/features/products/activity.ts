import { MU_OFFSET_MS } from "@/lib/mu-date";

/** One row as `product_recent_activity` returns it, camel-cased. */
export interface ActivityRow {
  eventId: string;
  happenedAt: string;
  /** 'movement' = stock really moved; 'line' = a service was billed. */
  source: "movement" | "line";
  /** ref_type for a movement, doc_type for a billed line. */
  kind: string;
  qty: number;
  refId: string | null;
  locationName: string | null;
  docNumber: string | null;
  /** The other side of the event: customer, supplier, or the transfer's far end. */
  partyName: string | null;
  note: string | null;
  actorName: string | null;
}

export interface ActivityView {
  key: string;
  when: string;
  qty: string;
  tone: "out" | "in" | "none";
  label: string;
  href: string | null;
  detail: string | null;
  locationName: string | null;
  actorName: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * UTC ISO → "30 Jul 18:02" in Mauritius local time. Hand-rolled like the rest of
 * mu-date (no Intl) so it renders identically on workerd and in the browser.
 */
export function shortWhen(iso: string): string {
  const d = new Date(Date.parse(iso) + MU_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm}`;
}

// numeric(12,3) arrives as 2.000 — nobody writes a wiper count to three decimals,
// but a 2.5 litre pour is real, so drop the zeros rather than the precision.
const trim = (n: number) => String(Number(n.toFixed(3)));

/** A job is referenced by the first block of its id everywhere else in the app. */
const jobRef = (id: string) => `JOB-${id.slice(0, 4).toUpperCase()}`;

/**
 * Turn a ledger row into the line the owner reads. The shape is deliberately
 * flat — label, optional link, one detail — so every kind of event renders as the
 * same row and the column edges stay put down the list.
 */
export function toActivityView(r: ActivityRow): ActivityView {
  const billed = r.kind === "invoice" || r.kind === "credit_note";
  const fallback = r.kind === "credit_note" ? "Credit note" : "Invoice";

  let label: string;
  let href: string | null = null;
  let detail: string | null = null;

  if (billed) {
    label = r.docNumber ?? fallback;
    href = r.refId ? `/sales/${r.refId}` : null;
    detail = r.partyName;
  } else if (r.kind === "job_card") {
    label = r.refId ? jobRef(r.refId) : "Job card";
    href = r.refId ? `/jobs/${r.refId}` : null;
    detail = r.partyName;
  } else if (r.kind === "purchase_order") {
    // /purchases has no detail page, so a linked-looking PO would be a dead end.
    label = "Purchase";
    detail = r.partyName;
  } else if (r.kind === "transfer") {
    // The row already says which shelf it is standing on; the party is the other end.
    label = "Transfer";
    detail = r.partyName ? `${r.qty < 0 ? "to" : "from"} ${r.partyName}` : null;
  } else {
    // Adjustment: the reason is mandatory, and it is the entire point of the row.
    label = "Adjustment";
    detail = r.note;
  }

  return {
    key: r.eventId,
    when: shortWhen(r.happenedAt),
    // A service was performed, not moved — count it, don't colour it in or out.
    qty: r.source === "line" ? `×${trim(Math.abs(r.qty))}` : r.qty < 0 ? `−${trim(-r.qty)}` : `+${trim(r.qty)}`,
    tone: r.source === "line" ? "none" : r.qty < 0 ? "out" : "in",
    label,
    href,
    detail,
    locationName: r.locationName,
    actorName: r.actorName,
  };
}
