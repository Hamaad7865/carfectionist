import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Printer, FileMinus } from "lucide-react";
import { getDocumentDetail } from "@/lib/supabase/queries/document";
import { StatusPill } from "@/components/ui/StatusPill";
import { RecordPaymentForm } from "@/features/documents/RecordPaymentForm";
import { ConvertButton } from "@/features/documents/ConvertButton";
import { ReviseButton } from "@/features/documents/ReviseButton";
import { DuplicateButton } from "@/features/documents/DuplicateButton";
import { VoidButton } from "@/features/documents/VoidButton";
import { CreditNoteButton } from "@/features/documents/CreditNoteButton";
import { formatMUR } from "@/lib/money";

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank transfer" };

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocumentDetail(id);
  if (!doc) notFound();
  if (doc.status === "draft") redirect(`/sales/${id}/edit`);

  const isInvoice = doc.docType === "invoice";
  const canPay = isInvoice && (doc.status === "issued" || doc.status === "partly_paid");
  const canVoid = isInvoice && doc.status === "issued" && doc.paidCents === 0;
  const canCredit = isInvoice && doc.paidCents > 0 && doc.status !== "void" && !doc.creditedByNumber;
  const title = doc.docType === "quote" ? "Quotation" : doc.docType === "credit_note" ? "Credit note" : "Invoice";

  return (
    <div className="p-6">
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
          <div className="flex items-center gap-2">
            <a href={`/print/doc/${doc.id}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-semibold text-body">
              <Printer size={15} /> Print / PDF
            </a>
            {doc.docType === "quote" && <ReviseButton quoteId={doc.id} />}
            {doc.docType === "invoice" && <DuplicateButton documentId={doc.id} />}
            {canVoid && <VoidButton documentId={doc.id} number={doc.number} />}
            {canCredit && <CreditNoteButton invoiceId={doc.id} number={doc.number} />}
            {doc.docType === "quote" && <ConvertButton quoteId={doc.id} />}
          </div>
        </div>

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

        {doc.docType === "credit_note" && doc.sourceId && (
          <div className="mt-4 flex items-center gap-2 rounded-[13px] border border-[rgba(255,84,104,0.25)] bg-[rgba(255,84,104,0.05)] px-4 py-2.5 text-[12.5px] text-body">
            <FileMinus size={15} className="text-pink" />
            Credit note against invoice{" "}
            <Link href={`/sales/${doc.sourceId}`} className="font-bold text-link hover:underline">{doc.sourceNumber ?? "—"}</Link>.
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Lines */}
          <div className="overflow-hidden rounded-[15px] border border-line bg-card">
            <div className="grid grid-cols-[1fr_60px_110px_110px] gap-3 border-b border-line bg-band px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-faint">
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
                <div className="flex justify-between py-1 text-muted"><span>Subtotal</span><span className="num text-ink">{formatMUR(doc.subtotalCents)}</span></div>
                <div className="flex justify-between py-1 text-muted"><span>VAT</span><span className="num text-ink">{formatMUR(doc.vatCents)}</span></div>
                <div className="mt-1 flex justify-between border-t border-line pt-2 font-bold"><span className="text-ink">Total (MUR)</span><span className="num text-brand">{formatMUR(doc.totalCents)}</span></div>
              </div>
            </div>
          </div>

          {/* Payments */}
          <div className="space-y-4">
            {isInvoice && (
              <div className="rounded-[15px] border border-line bg-card p-4 text-[13px]">
                <div className="flex justify-between py-1 text-muted"><span>Paid</span><span className="num text-ink">{formatMUR(doc.paidCents)}</span></div>
                <div className="flex justify-between py-1">
                  <span className="text-muted">Outstanding</span>
                  <span className={`num font-bold ${doc.outstandingCents <= 0 ? "text-mint" : "text-amber-ink"}`}>{formatMUR(doc.outstandingCents)}</span>
                </div>
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
          </div>
        </div>
      </div>
    </div>
  );
}
