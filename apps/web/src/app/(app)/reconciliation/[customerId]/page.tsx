import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, Receipt } from "lucide-react";
import {
  getCustomerAgedStatement,
  getCustomerPointsContext,
  getCustomerStatement,
  getSettleableInvoices,
} from "@/lib/supabase/queries/reports";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { ageDays, getCustomerInvoiceTrails, methodLabel } from "@/lib/supabase/queries/reconciliation";
import { SettleAccountPanel } from "@/features/documents/SettleAccountPanel";
import { StatementSendButton } from "@/features/reports/StatementSendButton";
import { EmailReceiptButton } from "@/features/tickets/EmailReceiptButton";
import { TicketPopup } from "@/features/tickets/TicketPopup";
import { muDate, muToday } from "@/lib/mu-date";
import { formatMUR } from "@/lib/money";
import { btn } from "@/components/ui/button";

// One customer's reconciliation: what they owe, aged — then every open bill
// with the payments taken toward it, then the lifetime ledger. Visibility
// only: settling happens through the settle panel, forgiving through a
// credit note on the invoice itself.

/** The ledger can run for years on a fleet account — the screen shows the tail. */
const LEDGER_LIMIT = 200;

const HEAD = "grid gap-3 border-b border-line bg-band px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.1em] text-th";
const ROW = "grid items-center gap-3 border-b border-line px-5 py-3 text-[13.5px] font-medium";

export default async function ReconciliationCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ receipt?: string }>;
}) {
  const { customerId } = await params;
  const sp = await searchParams;
  const receiptId = typeof sp.receipt === "string" && sp.receipt ? sp.receipt : undefined;
  const today = muToday();

  const [aged, settleable, points, statement, trails, popup] = await Promise.all([
    getCustomerAgedStatement(customerId),
    getSettleableInvoices(customerId),
    getCustomerPointsContext(customerId),
    getCustomerStatement(customerId),
    getCustomerInvoiceTrails(customerId),
    receiptId ? getReceipt(receiptId) : Promise.resolve(null),
  ]);
  if (!aged) notFound();

  const openBills = trails.length;
  const oldest = trails.map((t) => t.issueDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const ledger = statement?.lines ?? [];
  const ledgerTail = ledger.slice(-LEDGER_LIMIT);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href="/reconciliation" className={btn("quiet", "sm")}>
          <ChevronLeft size={14} /> Reconciliation
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[19px] font-extrabold text-ink-strong sm:text-[20px]">{aged.customerName}</h2>
          {aged.customerEmail && <div className="text-[12.5px] font-medium text-muted">{aged.customerEmail}</div>}
        </div>
        <a href={`/api/reports/statement/${customerId}/pdf`} target="_blank" rel="noreferrer" className={btn("ghost", "sm")}>
          <Download size={14} /> PDF
        </a>
        <StatementSendButton customerId={customerId} customerName={aged.customerName} email={aged.customerEmail} />
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="text-[13px] font-semibold text-muted">Balance owed</div>
          <div className="num mt-2 text-[30px] font-extrabold text-ink-strong">{formatMUR(aged.soldeCents)}</div>
        </div>
        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="text-[13px] font-semibold text-muted">Open bills</div>
          <div className="num mt-2 text-[30px] font-extrabold text-ink-strong">{openBills}</div>
        </div>
        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="text-[13px] font-semibold text-muted">Oldest unpaid</div>
          <div className="num mt-2 text-[30px] font-extrabold text-ink-strong">
            {oldest ? `${ageDays(oldest, today)}d` : "—"}
          </div>
          {oldest && <div className="num mt-1 text-[12.5px] font-medium text-faint">since {oldest}</div>}
        </div>
      </div>

      {aged.buckets.some((b) => b.cents !== 0) && (
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="border-b border-line px-5 py-3.5 font-display text-[15px] font-bold text-ink-strong">Balance — aged</div>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid border-b border-line bg-sub px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.1em] text-th" style={{ gridTemplateColumns: `130px repeat(${aged.buckets.length}, 1fr)` }}>
                <span>Solde</span>
                {aged.buckets.map((b) => <span key={b.key} className="text-right">{b.label}</span>)}
              </div>
              <div className="grid items-center px-5 py-3 text-[13.5px] font-medium" style={{ gridTemplateColumns: `130px repeat(${aged.buckets.length}, 1fr)` }}>
                <span className="num font-extrabold text-brand">{formatMUR(aged.soldeCents)}</span>
                {aged.buckets.map((b) => <span key={b.key} className="num text-right text-body">{b.cents ? formatMUR(b.cents) : "—"}</span>)}
              </div>
            </div>
          </div>
        </div>
      )}

      {settleable.length > 0 && (
        <SettleAccountPanel
          customerId={customerId}
          invoices={settleable}
          pointsEnabled={points.pointsEnabled}
          pointsBalance={points.pointsBalance}
          pointValueRupees={points.pointValueRupees}
        />
      )}

      {/* ── Each bill, and what was paid toward it ── */}
      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5 font-display text-[15px] font-bold text-ink-strong">Bills &amp; payments</div>
        {trails.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13.5px] font-medium text-faint">
            No open bills — anything they ever paid lives in the ledger below.
          </div>
        ) : (
          <div className="min-w-[680px]">
            <div className={HEAD} style={{ gridTemplateColumns: "140px 110px 130px 130px 130px" }}>
              <span>Bill</span>
              <span>Billed</span>
              <span className="text-right">Total</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Still owed</span>
            </div>
            {trails.map((t) => (
              <details key={t.id} className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className={`${ROW} hover:bg-sub`} style={{ gridTemplateColumns: "140px 110px 130px 130px 130px" }}>
                    <span className="flex items-center gap-1.5">
                      {t.payments.length > 0 && (
                        <span className="select-none text-[10px] text-faint transition-transform group-open:rotate-90">▶</span>
                      )}
                      <Link
                        href={`/sales/${t.id}`}
                        className="num font-bold text-link hover:underline"
                      >
                        {t.number ?? "—"}
                      </Link>
                    </span>
                    <span className="num text-muted">{t.issueDate ?? "—"}</span>
                    <span className="num text-right text-muted">{formatMUR(t.totalCents)}</span>
                    <span className="num text-right text-mint">{t.paidCents ? formatMUR(t.paidCents) : "—"}</span>
                    <span className="num text-right font-bold text-ink">{formatMUR(t.outstandingCents)}</span>
                  </div>
                </summary>
                {t.payments.length > 0 && (
                  <div className="border-b border-line bg-sub">
                    {t.payments.map((p) => (
                      <div
                        key={p.id}
                        className="grid items-center gap-3 px-5 py-2 pl-10 text-[12.5px] text-muted"
                        style={{ gridTemplateColumns: "140px 110px 130px 130px 130px" }}
                      >
                        <span className="flex items-center gap-1.5">
                          <Receipt size={12} className="shrink-0 text-faint" />
                          {muDate(p.receivedAt)}
                        </span>
                        <span>{methodLabel(p.method)}</span>
                        <span />
                        <span className="num text-right font-semibold text-mint">{formatMUR(p.amountCents)}</span>
                        <span className="text-right">
                          <Link
                            href={`/reconciliation/${customerId}?receipt=${encodeURIComponent(t.id)}`}
                            scroll={false}
                            className="text-[12px] font-semibold text-link hover:underline"
                          >
                            Receipt
                          </Link>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
      </div>

      {/* ── Lifetime ledger with a running balance ── */}
      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5 font-display text-[15px] font-bold text-ink-strong">
          Ledger
          {ledger.length > ledgerTail.length && (
            <span className="ml-2 text-[12px] font-semibold text-faint">latest {ledgerTail.length} of {ledger.length} entries</span>
          )}
        </div>
        {ledgerTail.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13.5px] font-medium text-faint">No ledger entries for this customer.</div>
        ) : (
          <div className="min-w-[720px]">
            <div className={HEAD} style={{ gridTemplateColumns: "110px 1fr 130px 130px 130px" }}>
              <span>Date</span>
              <span>Detail</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span className="text-right">Balance</span>
            </div>
            {ledgerTail.map((l, i) => (
              <div key={`${l.date}-${i}`} className={ROW} style={{ gridTemplateColumns: "110px 1fr 130px 130px 130px" }}>
                <span className="num text-muted">{l.date}</span>
                <span className="min-w-0 truncate">
                  {l.kind === "invoice" && l.refId ? (
                    <Link href={`/sales/${l.refId}`} className="font-semibold text-body hover:underline">
                      {l.ref ?? "Invoice"} · {l.detail}
                    </Link>
                  ) : l.kind === "payment" && l.refId ? (
                    <span>
                      {l.detail}
                      {l.ref && <span className="text-muted"> · {l.ref}</span>}{" "}
                      <Link
                        href={`/reconciliation/${customerId}?receipt=${encodeURIComponent(l.refId)}`}
                        scroll={false}
                        className="text-[12px] font-semibold text-link hover:underline"
                      >
                        Receipt
                      </Link>
                    </span>
                  ) : (
                    <span>
                      {l.detail}
                      {l.ref && <span className="text-muted"> · {l.ref}</span>}
                    </span>
                  )}
                </span>
                <span className="num text-right text-muted">{l.debitCents ? formatMUR(l.debitCents) : ""}</span>
                <span className="num text-right text-mint">{l.creditCents ? formatMUR(l.creditCents) : ""}</span>
                <span className="num text-right font-bold text-ink">{formatMUR(l.balanceCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {popup && receiptId && (
        <Suspense fallback={null}>
          <TicketPopup r={popup} docId={receiptId} param="receipt" emailSlot={<EmailReceiptButton docId={receiptId} defaultEmail={popup.customerEmail} />} />
        </Suspense>
      )}
    </div>
  );
}
