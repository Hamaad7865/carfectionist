import { Suspense } from "react";
import Link from "next/link";
import { Plus, ChevronRight, Store, MessageSquareText } from "lucide-react";
import { listDocuments } from "@/lib/supabase/queries/documents";
import { getTickets } from "@/lib/supabase/queries/tickets";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { DocumentsFilterBar } from "@/features/documents/DocumentsFilterBar";
import { RowSendButton } from "@/features/documents/RowSendButton";
import { TicketPopup } from "@/features/tickets/TicketPopup";
import { EmailReceiptButton } from "@/features/tickets/EmailReceiptButton";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";
import { muToday } from "@/lib/mu-date";
import { btn } from "@/components/ui/button";

const rs = (v: string) => formatMUR(Math.round(Number(v) * 100));
const COLS = "grid-cols-[120px_1fr_90px_90px_120px_130px_36px]";
const TCOLS = "grid-cols-[130px_110px_100px_70px_70px_130px_130px_36px]";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view = pick("view") === "tickets" ? "tickets" : "documents";
  const today = muToday();

  const docsData =
    view === "documents"
      ? await listDocuments({
          type: pick("type"),
          status: pick("status"),
          from: pick("from"),
          to: pick("to"),
          customer: pick("customer"),
        })
      : null;
  const ticketsData = view === "tickets" ? await getTickets(pick("from"), pick("to")) : null;
  const ticketId = view === "tickets" ? pick("t") : undefined;
  const popup = ticketId ? await getReceipt(ticketId) : null;
  const rows = docsData?.rows ?? [];
  const count = docsData?.count ?? 0;
  const totalCents = docsData?.totalCents ?? 0;
  const tq = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ view: "tickets" });
    for (const [k, v] of Object.entries({ from: pick("from"), to: pick("to"), ...extra })) if (v) p.set(k, v);
    return `/sales?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-[19px] font-extrabold text-ink-strong sm:text-[20px]">Quotes &amp; Invoices</h2>
          {/* View switch — Tickets is the Cashmag-style invoice history */}
          <div className="flex rounded-[10px] border border-line-2 bg-sub p-0.5">
            <Link href="/sales" className={`h-8 rounded-[8px] px-3 text-[12px] font-bold leading-8 ${view === "documents" ? "bg-card text-ink shadow-sm" : "text-muted"}`}>Documents</Link>
            <Link href={`/sales?view=tickets&from=${today}&to=${today}`} className={`h-8 rounded-[8px] px-3 text-[12px] font-bold leading-8 ${view === "tickets" ? "bg-card text-ink shadow-sm" : "text-muted"}`}>Tickets</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/sales/counter"
            className={btn("ghost", "lg", "flex-1 gap-2 sm:flex-none")}
          >
            <Store size={16} strokeWidth={2.2} /> Counter sale
          </Link>
          <Link
            href="/sales/new?type=invoice"
            className={btn("primary", "lg", "flex-1 gap-2 px-[18px] sm:flex-none")}
          >
            <Plus size={16} strokeWidth={2.4} /> New document
          </Link>
        </div>
      </div>

      {view === "documents" && (
      <Suspense fallback={null}>
        <DocumentsFilterBar />
      </Suspense>
      )}

      {/* ── TICKETS (Cashmag invoice history) ── */}
      {view === "tickets" && ticketsData && (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Period</span>
            <Suspense fallback={null}>
              <DateRangeFilter label={false} />
            </Suspense>
            <div className="flex-1" />
            <span className="text-[12.5px] text-muted">
              {ticketsData.count} ticket{ticketsData.count === 1 ? "" : "s"} ·{" "}
              <span className="num font-bold text-body">{formatMUR(ticketsData.totalExclCents)}</span> excl ·{" "}
              <span className="num font-bold text-ink-strong">{formatMUR(ticketsData.totalInclCents)}</span> incl
            </span>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-line bg-card">
            <div className={`hidden md:grid ${TCOLS} gap-3 border-b border-line bg-band px-5 py-3`}>
              {["Reference", "Order / Booking", "Date", "Hour", "Service", "Total excl tax", "Total"].map((h, i) => (
                <span key={h} className={`text-[10.5px] font-bold uppercase tracking-[0.1em] text-th ${i >= 5 ? "text-right" : ""}`}>{h}</span>
              ))}
              <span />
            </div>
            {ticketsData.rows.length === 0 ? (
              <div className="px-5 py-16 text-center text-[13px] text-faint">No tickets in this period.</div>
            ) : (
              ticketsData.rows.map((r) => (
                <Link key={r.id} href={tq({ t: r.id })} scroll={false} className="block border-b border-line hover:bg-sub">
                  {/* Mobile card */}
                  <div className="flex items-start justify-between gap-3 px-4 py-3 md:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="num text-[13px] font-bold" style={{ color: r.docType === "credit_note" ? "#d63b50" : "#1e6fe0" }}>{r.number ?? "—"}</span>
                        {r.cancelLabel && <span className="rounded-[5px] bg-[rgba(214,59,80,0.12)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-rose">{r.cancelLabel}</span>}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted">{r.date} · {r.hour} · {r.serviceCount} line{r.serviceCount === 1 ? "" : "s"}</div>
                      {r.voidReason && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-rose" title={r.voidReason}>Voided — {r.voidReason}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className={`num text-[14px] font-bold ${r.inclCents < 0 ? "text-rose" : "text-ink-strong"}`}>{formatMUR(r.inclCents)}</span>
                      {r.number && r.docType !== "credit_note" && !r.cancelLabel && <RowSendButton documentId={r.id} />}
                    </div>
                  </div>
                  {/* Desktop grid */}
                  <div className={`hidden md:grid ${TCOLS} items-center gap-3 px-5 py-3`}>
                    <span>
                      <span className="num block text-[12.5px] font-bold" style={{ color: r.docType === "credit_note" ? "#d63b50" : "#1e6fe0" }}>{r.number ?? "—"}</span>
                      {r.cancelLabel && <span className="mt-0.5 inline-block rounded-[5px] bg-[rgba(214,59,80,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose">{r.cancelLabel}</span>}
                      {r.voidReason && <span className="mt-0.5 block truncate text-[10.5px] text-rose" title={r.voidReason}>{r.voidReason}</span>}
                    </span>
                    {r.plate ? (
                      <span className={`num inline-block w-fit rounded-[6px] border px-2 py-0.5 text-[11px] font-bold ${r.jobId ? "border-[rgba(43,140,255,0.3)] bg-[rgba(43,140,255,0.07)] text-link" : "border-line-2 bg-sub text-body"}`}>
                        {r.plate}{r.jobId ? " · job" : ""}
                      </span>
                    ) : r.jobId ? (
                      <span className="text-[12px] font-semibold text-link">Job →</span>
                    ) : (
                      <span className="text-[12px] text-faint">—</span>
                    )}
                    <span className="num text-[12px] text-muted">{r.date}</span>
                    <span className="num text-[12px] text-muted">{r.hour}</span>
                    <span className="num text-[12px] text-muted">{r.serviceCount}</span>
                    <span className={`num text-right text-[12.5px] ${r.exclCents < 0 ? "font-bold text-rose" : "text-body"}`}>{formatMUR(r.exclCents)}</span>
                    <span className={`num text-right text-[13px] font-bold ${r.inclCents < 0 ? "text-rose" : "text-ink-strong"}`}>{formatMUR(r.inclCents)}</span>
                    <span className="flex items-center justify-end gap-1.5 text-faint">
                      {r.number && r.docType !== "credit_note" && !r.cancelLabel && <RowSendButton documentId={r.id} />}
                      <ChevronRight size={16} />
                    </span>
                  </div>
                </Link>
              ))
            )}
            <div className="flex items-center justify-end gap-4 bg-band px-4 py-3 text-[13px] font-bold text-body sm:px-5">
              <span>Excl <span className="num text-ink-strong">{formatMUR(ticketsData.totalExclCents)}</span></span>
              <span>Total <span className="num text-ink-strong">{formatMUR(ticketsData.totalInclCents)}</span></span>
            </div>
          </div>

          {popup && ticketId && (
            <Suspense fallback={null}>
              <TicketPopup r={popup} docId={ticketId} emailSlot={<EmailReceiptButton docId={ticketId} defaultEmail={popup.customerEmail} />} />
            </Suspense>
          )}
        </>
      )}

      {view === "documents" && (
      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className={`hidden md:grid ${COLS} gap-3.5 border-b border-line bg-band px-5 py-3`}>
          {["Number", "Customer", "Date", "Method", "Status", "Total"].map((h, i) => (
            <span key={h} className={`text-[10.5px] font-bold uppercase tracking-[0.1em] text-th ${i === 5 ? "text-right" : ""}`}>
              {h}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No documents yet. Create your first quote or invoice.</div>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/sales/${r.id}`} className="block border-b border-line hover:bg-sub">
              {/* Mobile card */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 md:hidden">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num text-[13px] font-bold" style={{ color: r.doc_type === "quote" ? "#6f5cd9" : "#1e6fe0" }}>{r.number ?? "Draft"}</span>
                    <StatusPill status={r.status} />
                    {r.hasDiscount && <span className="rounded-[5px] bg-[rgba(245,166,35,0.16)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-ink">Disc</span>}
                  </div>
                  <div className="mt-1 truncate text-[13px] font-semibold text-body">{r.customerName ?? "—"}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">{r.issue_date ?? r.created_at.slice(0, 10)} · {r.methodLabel}</div>
                  {r.comment && (
                    <div className="mt-0.5 flex items-start gap-1 text-[11.5px] text-faint">
                      <MessageSquareText size={12} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{r.comment}</span>
                    </div>
                  )}
                  {r.voidReason && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-rose" title={r.voidReason}>Voided — {r.voidReason}</div>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="num text-[14px] font-bold text-ink-strong">{rs(r.total_incl)}</div>
                  {r.number && <RowSendButton documentId={r.id} />}
                </div>
              </div>
              {/* Desktop grid */}
              <div className={`hidden md:grid ${COLS} items-center gap-3.5 px-5 py-3`}>
                <span className="num text-[12.5px] font-bold" style={{ color: r.doc_type === "quote" ? "#6f5cd9" : "#1e6fe0" }}>{r.number ?? "Draft"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-body">{r.customerName ?? "—"}</span>
                  {r.comment && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-faint" title={r.comment}>
                      <MessageSquareText size={11} className="shrink-0" />
                      <span className="truncate">{r.comment}</span>
                    </span>
                  )}
                  {r.voidReason && <span className="mt-0.5 block truncate text-[11px] text-rose" title={r.voidReason}>Voided — {r.voidReason}</span>}
                </span>
                <span className="num text-[12px] text-muted">{r.issue_date ?? r.created_at.slice(0, 10)}</span>
                <span className="text-[12px] text-muted">{r.methodLabel}</span>
                <span className="flex items-center gap-1.5"><StatusPill status={r.status} />{r.hasDiscount && <span className="rounded-[5px] bg-[rgba(245,166,35,0.16)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-ink">Disc</span>}</span>
                <span className="num text-right text-[13px] font-bold text-ink-strong">{rs(r.total_incl)}</span>
                <span className="flex items-center justify-end gap-1.5 text-faint">
                  {r.number && <RowSendButton documentId={r.id} />}
                  <ChevronRight size={16} />
                </span>
              </div>
            </Link>
          ))
        )}

        <div className="flex items-center justify-between gap-2 bg-band px-4 py-3 sm:px-5">
          <span className="text-[12px] font-semibold text-th">
            {count} document{count === 1 ? "" : "s"}
            {rows.length < count ? ` (showing ${rows.length})` : ""}
          </span>
          <span className="text-[13px] font-bold text-body">
            Total <span className="num text-ink-strong">{formatMUR(totalCents)}</span>
          </span>
        </div>
      </div>
      )}
    </div>
  );
}
