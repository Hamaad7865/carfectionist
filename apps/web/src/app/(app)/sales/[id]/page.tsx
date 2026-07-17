import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Printer, FileMinus, Receipt, ArrowRight } from "lucide-react";
import { getDocumentDetail } from "@/lib/supabase/queries/document";
import { getDealFlow } from "@/lib/supabase/queries/flow";
import { FlowStepper } from "@/components/flow/FlowStepper";
import { StatusPill } from "@/components/ui/StatusPill";
import { StatementSendButton } from "@/features/reports/StatementSendButton";
import { getSessionContext } from "@/lib/auth/session";
import { btn } from "@/components/ui/button";
import { RecordPaymentForm } from "@/features/documents/RecordPaymentForm";
import { ConvertButton } from "@/features/documents/ConvertButton";
import { ReviseButton } from "@/features/documents/ReviseButton";
import { DuplicateButton } from "@/features/documents/DuplicateButton";
import { VoidButton } from "@/features/documents/VoidButton";
import { CreditNoteButton } from "@/features/documents/CreditNoteButton";
import { HandOverButton } from "@/features/documents/HandOverButton";
import { DocumentShareBar } from "@/features/documents/DocumentShareBar";
import { CarDiagram } from "@/features/intake/CarDiagram";
import { StartJobButton } from "@/features/intake/StartJobButton";
import { markerMeta } from "@/features/intake/damage";
import { formatMUR } from "@/lib/money";

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank transfer" };

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, session] = await Promise.all([getDocumentDetail(id), getSessionContext()]);
  if (!doc) notFound();
  if (doc.status === "draft") redirect(`/sales/${id}/edit`);
  // Statements are receivables — same floor as Reports (owner/manager/accountant).
  const canStatement = !!session && ["owner", "manager", "accountant"].includes(session.role);

  // The car's journey — quotes and invoices sit inside the same five steps.
  const flow = doc.docType !== "credit_note" ? await getDealFlow({ documentId: id }) : null;

  const isInvoice = doc.docType === "invoice";
  const canPay = isInvoice && (doc.status === "issued" || doc.status === "partly_paid");
  const canVoid = isInvoice && doc.status === "issued" && doc.paidCents === 0;
  const canCredit = isInvoice && doc.paidCents > 0 && doc.status !== "void" && !doc.creditedByNumber;
  const title = doc.docType === "quote" ? "Quotation" : doc.docType === "credit_note" ? "Credit note" : "Invoice";

  // Once a quote is BILLED, "Convert to invoice" and "Accept → create job" are
  // finished business — offering them again reads like the app forgot (owner's
  // report: an accepted, PAID quote still shouting "Convert to invoice"). The
  // flow resolver already found the live invoice (voids excluded), so reuse it:
  // the button becomes the way TO that invoice instead.
  const invoiceStep = flow?.find((s) => s.key === "invoice");
  const billedHref = doc.docType === "quote" && invoiceStep?.state === "done" ? invoiceStep.href : null;

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/sales" className="text-[13px] font-semibold text-muted hover:text-body">← Sales</Link>
            <div className="mt-1 flex items-center gap-3">
              <h2 className="font-display text-[22px] font-extrabold text-ink-strong">{title}</h2>
              <span className="num text-muted">{doc.number}</span>
              <StatusPill status={doc.status} />
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {doc.customerName ?? "—"} · {doc.issueDate ?? doc.createdAt.slice(0, 10)}
            </p>
          </div>
          {/* flex-wrap: when the row runs out of room, whole buttons move to the
              next line — labels never break mid-text (the screenshotted bug). */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {doc.docType === "invoice" && (
              <a href={`/print/receipt/${doc.id}`} target="_blank" rel="noreferrer" className={btn()}>
                <Receipt size={15} /> Receipt
              </a>
            )}
            {doc.number && doc.status !== "void" ? (
              <DocumentShareBar documentId={doc.id} number={doc.number} defaultEmail={doc.customerEmail} defaultPhone={doc.customerPhone} />
            ) : (
              <a href={`/print/doc/${doc.id}`} target="_blank" rel="noreferrer" className={btn()}>
                <Printer size={15} /> Print / PDF
              </a>
            )}
            {/* Revising is negotiation; a billed quote is past negotiating. */}
            {doc.docType === "quote" && !billedHref && <ReviseButton quoteId={doc.id} />}
            {doc.docType === "invoice" && <DuplicateButton documentId={doc.id} />}
            {canVoid && <VoidButton documentId={doc.id} number={doc.number} />}
            {canCredit && <CreditNoteButton invoiceId={doc.id} number={doc.number} />}
            {doc.docType === "quote" &&
              !["declined", "expired"].includes(doc.status) &&
              (billedHref ? (
                <Link href={billedHref} className={btn("primary")}>
                  Go to invoice <ArrowRight size={15} />
                </Link>
              ) : (
                <ConvertButton quoteId={doc.id} />
              ))}
          </div>
        </div>

        {flow && (
          <div className="mt-4">
            <FlowStepper steps={flow} />
          </div>
        )}

        {/* Quote -> job actions must not be trapped behind intake data: a quote
            created via "+ New document" has no markers/photos, yet still needs
            "Accept -> create job" (and, once one exists, the way to its job).
            Once BILLED, the prompt disappears — the deal moved on without a
            job, and asking again after the invoice reads like a step backwards. */}
        {doc.docType === "quote" &&
          !(doc.intake && (doc.intake.markers.length > 0 || doc.intake.photos.length > 0)) &&
          !(billedHref && !doc.jobId) && (
          <div className="mt-4 flex items-center justify-between rounded-[13px] border border-line bg-card px-4 py-2.5">
            <span className="text-[12.5px] text-muted">{doc.jobId ? "This quote has a job on the board." : "Client accepted this quote?"}</span>
            {doc.jobId ? (
              <Link href={`/jobs/${doc.jobId}`} className="text-[12.5px] font-bold text-link hover:underline">View job -&gt;</Link>
            ) : ["declined", "expired"].includes(doc.status) ? (
              <span className="text-[12px] font-semibold text-faint">Quote is {doc.status}</span>
            ) : (
              <StartJobButton documentId={doc.id} quote />
            )}
          </div>
        )}

        {doc.status === "void" && (
          <div className="mt-4 flex items-start gap-3 rounded-[13px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.06)] px-4 py-3">
            <span className="mt-0.5 rounded-full bg-rose px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Void</span>
            <div className="text-[12.5px] text-body">
              This {doc.docType} was voided{doc.voidedAt ? ` on ${doc.voidedAt.slice(0, 10)}` : ""}
              {doc.voidReason ? <> — <span className="font-semibold">{doc.voidReason}</span></> : ""}. Stock movements were reversed; the number is retained.
            </div>
          </div>
        )}

        {isInvoice && doc.creditedByNumber && (
          <div className="mt-4 flex items-center gap-2 rounded-[13px] border border-[rgba(255,84,104,0.25)] bg-[rgba(255,84,104,0.05)] px-4 py-2.5 text-[12.5px] text-body">
            <FileMinus size={15} className="text-pink" />
            Credited by <span className="num font-bold text-pink">{doc.creditedByNumber}</span>.
          </div>
        )}

        {doc.acceptedSignature && (
          <div className="mt-4 flex items-center gap-4 rounded-[13px] border border-[rgba(13,167,124,0.25)] bg-[rgba(13,167,124,0.05)] px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={doc.acceptedSignature.url} alt="Client signature" className="h-16 rounded-[8px] border border-line bg-white object-contain" />
            <div className="text-[12.5px] text-body">
              <div className="font-semibold text-ink">Accepted — signed by the client{doc.acceptedSignature.name ? ` (${doc.acceptedSignature.name})` : ""}</div>
              {doc.acceptedSignature.at && <div className="text-muted">{new Date(doc.acceptedSignature.at).toLocaleString("en-GB", { timeZone: "Indian/Mauritius", dateStyle: "medium", timeStyle: "short" })}</div>}
            </div>
          </div>
        )}

        {doc.docType === "credit_note" && doc.sourceId && (
          <div className="mt-4 flex items-center gap-2 rounded-[13px] border border-[rgba(255,84,104,0.25)] bg-[rgba(255,84,104,0.05)] px-4 py-2.5 text-[12.5px] text-body">
            <FileMinus size={15} className="text-pink" />
            Credit note against invoice{" "}
            <Link href={`/sales/${doc.sourceId}`} className="font-bold text-link hover:underline">{doc.sourceNumber ?? "—"}</Link>.
          </div>
        )}

        {doc.intake && (doc.intake.markers.length > 0 || doc.intake.photos.length > 0) && (
          <div className="mt-6 rounded-[15px] border border-line bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Condition &amp; Damage (at intake)</span>
              {doc.jobId ? (
                <Link href={`/jobs/${doc.jobId}`} className="text-[12.5px] font-bold text-link hover:underline">View job →</Link>
              ) : billedHref ? null : (
                <StartJobButton documentId={doc.id} quote={doc.docType === "quote"} />
              )}
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="sm:w-[220px] sm:shrink-0">
                <CarDiagram markers={doc.intake.markers} maxWidth={220} />
                {doc.intake.markers.length > 0 && (
                  <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                    {[...new Set(doc.intake.markers.map((m) => m.type))].map((t) => (
                      <span key={t} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                        <span className="size-2.5 rounded-full" style={{ background: markerMeta(t).color }} />
                        {markerMeta(t).label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {doc.intake.photos.length > 0 && (
                <div className="flex-1">
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Before photos</div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {doc.intake.photos.map((p) => (
                      <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="aspect-[4/3] overflow-hidden rounded-[10px] border border-line bg-sub">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {doc.comment && (
          <div className="mt-4 rounded-[13px] border border-line bg-card px-4 py-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Internal comment</div>
            <p className="whitespace-pre-wrap text-[13px] text-body">{doc.comment}</p>
            <p className="mt-1 text-[11px] text-faint">Internal only — not shown on the customer&rsquo;s receipt or invoice.</p>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Lines */}
          <div className="overflow-hidden rounded-[15px] border border-line bg-card">
            <div className="grid grid-cols-[1fr_60px_110px_110px] gap-3 border-b border-line bg-band px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-th">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Amount</span>
            </div>
            {doc.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_60px_110px_110px] gap-3 border-b border-line px-5 py-2.5">
                <div>
                  <div className="text-[13px] font-semibold text-ink">{l.title}</div>
                  {l.description && <div className="whitespace-pre-wrap text-[12px] text-muted">{l.description}</div>}
                </div>
                <span className="num text-right text-[12.5px] text-muted">{l.qty}</span>
                <span className="num text-right text-[12.5px] text-body">{formatMUR(l.rateCents)}</span>
                <span className="num text-right text-[13px] font-semibold text-ink">{formatMUR(l.amountCents)}</span>
              </div>
            ))}
            <div className="flex justify-end px-5 py-3">
              <div className="w-56 text-[13px]">
                <div className="flex justify-between py-1 text-muted"><span>Subtotal</span><span className="num text-ink">{formatMUR(doc.grossSubtotalCents)}</span></div>
                {doc.orderDiscountCents > 0 && (
                  <div className="flex justify-between py-1 text-amber-ink">
                    <span>Discount{doc.discountKind === "percent" ? ` (${doc.discountValue}%)` : ""}</span>
                    <span className="num">−{formatMUR(doc.orderDiscountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 text-muted"><span>VAT</span><span className="num text-ink">{formatMUR(doc.vatCents)}</span></div>
                <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span className="text-ink">Total (MUR)</span><span className="num text-brand">{formatMUR(doc.totalCents)}</span></div>
              </div>
            </div>
          </div>

          {/* Payments */}
          <div className="space-y-4">
            {/* A voided invoice owes nothing — its total_incl stays but paid is 0,
                so an unguarded "Outstanding = total − paid" would read as money due.
                The VOID banner above already tells the story; no payment summary. */}
            {isInvoice && doc.status !== "void" && (
              <div className="rounded-[15px] border border-line bg-card p-4 text-[13px]">
                <div className="flex justify-between py-1 text-muted"><span>Paid</span><span className="num text-ink">{formatMUR(doc.paidCents)}</span></div>
                <div className="flex justify-between py-1">
                  <span className="text-muted">Outstanding</span>
                  <span className={`num font-bold ${doc.outstandingCents <= 0 ? "text-mint" : "text-amber-ink"}`}>{formatMUR(doc.outstandingCents)}</span>
                </div>
                {/* Money is owed → offer the customer's statement of account right
                    here, instead of a detour through Reports. It covers their WHOLE
                    account, not just this invoice — the label says so. Gated to the
                    roles sendStatementEmailAction itself accepts, so a cashier is
                    never shown a button the server would refuse. */}
                {canStatement && doc.outstandingCents > 0 && doc.customerId && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-body">Statement of account</div>
                      <div className="text-[11px] text-faint">Everything {doc.customerName ?? "this customer"} owes — not just this invoice</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <a
                        href={`/api/reports/statement/${doc.customerId}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] font-semibold text-link hover:underline"
                      >
                        View PDF
                      </a>
                      <StatementSendButton customerId={doc.customerId} customerName={doc.customerName ?? "the customer"} email={doc.customerEmail} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {doc.payments.length > 0 && (
              <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                <div className="border-b border-line px-4 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Payments</div>
                <ul className="divide-y divide-line text-[13px]">
                  {doc.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="font-semibold text-ink">{METHOD_LABEL[p.method] ?? p.method}</span>
                        {p.externalRef && <span className="ml-2 text-[11px] text-faint">{p.externalRef}</span>}
                        {p.changeCents != null && p.changeCents > 0 && <span className="ml-2 text-[11px] text-faint">change {formatMUR(p.changeCents)}</span>}
                      </div>
                      <span className="num font-bold text-ink">{formatMUR(p.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canPay && <RecordPaymentForm invoiceId={doc.id} outstandingCents={doc.outstandingCents} />}
            {/* Open bill + READY job: the customer can take the car on account — the
                balance stays owed (statement + TO COLLECT), the job delivers. */}
            {canPay && doc.jobStatus === "ready" && doc.customerName && (
              <div className="mt-3">
                <HandOverButton
                  invoiceId={doc.id}
                  number={doc.number}
                  customerName={doc.customerName}
                  outstanding={formatMUR(doc.outstandingCents)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
