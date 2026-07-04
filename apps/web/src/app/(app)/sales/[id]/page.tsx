import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Printer } from "lucide-react";
import { getDocumentDetail } from "@/lib/supabase/queries/document";
import { StatusPill } from "@/components/ui/StatusPill";
import { RecordPaymentForm } from "@/features/documents/RecordPaymentForm";
import { ConvertButton } from "@/features/documents/ConvertButton";
import { formatMUR } from "@/lib/money";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  juice: "Juice",
  bank_transfer: "Bank transfer",
};

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocumentDetail(id);
  if (!doc) notFound();
  if (doc.status === "draft") redirect(`/sales/${id}/edit`);

  const isInvoice = doc.docType === "invoice";
  const canPay = isInvoice && (doc.status === "issued" || doc.status === "partly_paid");
  const title = doc.docType === "quote" ? "Quotation" : doc.docType === "credit_note" ? "Credit note" : "Invoice";

  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/sales" className="text-[13px] text-graphite-400 hover:text-graphite-100">
              ← Sales
            </Link>
            <div className="mt-1 flex items-center gap-3">
              <h2 className="font-display text-2xl font-semibold text-graphite-100">{title}</h2>
              <span className="num text-graphite-400">{doc.number}</span>
              <StatusPill status={doc.status} />
            </div>
            <p className="mt-1 text-sm text-graphite-500">
              {doc.customerName ?? "—"} · {doc.issueDate ?? doc.createdAt.slice(0, 10)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/print/doc/${doc.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-graphite-700 bg-graphite-850 px-3 text-[13px] text-graphite-100 hover:border-graphite-600"
            >
              <Printer size={15} /> Print / PDF
            </a>
            {doc.docType === "quote" && <ConvertButton quoteId={doc.id} />}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Lines + totals */}
          <div className="overflow-hidden rounded-xl border border-graphite-700">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-graphite-850 text-left text-[11px] uppercase tracking-wider text-graphite-500">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l, i) => (
                  <tr key={i} className="border-t border-graphite-700 align-top">
                    <td className="px-4 py-2.5">
                      <div className="text-graphite-100">{l.title}</div>
                      {l.description && <div className="whitespace-pre-wrap text-[12px] text-graphite-500">{l.description}</div>}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-graphite-300">{l.qty}</td>
                    <td className="num px-4 py-2.5 text-right text-graphite-300">{formatMUR(l.rateCents)}</td>
                    <td className="num px-4 py-2.5 text-right text-graphite-100">{formatMUR(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-graphite-700">
                  <td colSpan={3} className="px-4 py-2 text-right text-graphite-400">Subtotal</td>
                  <td className="num px-4 py-2 text-right text-graphite-100">{formatMUR(doc.subtotalCents)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-graphite-400">VAT</td>
                  <td className="num px-4 py-2 text-right text-graphite-100">{formatMUR(doc.vatCents)}</td>
                </tr>
                <tr className="border-t border-graphite-700 bg-graphite-850">
                  <td colSpan={3} className="px-4 py-2.5 text-right font-semibold text-graphite-100">Total (MUR)</td>
                  <td className="num px-4 py-2.5 text-right font-semibold text-teal">{formatMUR(doc.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payments */}
          <div className="space-y-4">
            {isInvoice && (
              <div className="rounded-xl border border-graphite-700 bg-graphite-900 p-4 text-[13px]">
                <div className="flex justify-between py-1 text-graphite-400">
                  <span>Paid</span>
                  <span className="num text-graphite-100">{formatMUR(doc.paidCents)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-graphite-400">Outstanding</span>
                  <span className={`num font-semibold ${doc.outstandingCents <= 0 ? "text-success" : "text-warning"}`}>
                    {formatMUR(doc.outstandingCents)}
                  </span>
                </div>
              </div>
            )}

            {doc.payments.length > 0 && (
              <div className="rounded-xl border border-graphite-700">
                <div className="border-b border-graphite-700 px-4 py-2 text-[11px] uppercase tracking-wider text-graphite-500">
                  Payments
                </div>
                <ul className="divide-y divide-graphite-700 text-[13px]">
                  {doc.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="text-graphite-100">{METHOD_LABEL[p.method] ?? p.method}</span>
                        {p.externalRef && <span className="ml-2 text-[11px] text-graphite-500">{p.externalRef}</span>}
                        {p.changeCents != null && p.changeCents > 0 && (
                          <span className="ml-2 text-[11px] text-graphite-500">change {formatMUR(p.changeCents)}</span>
                        )}
                      </div>
                      <span className="num text-graphite-100">{formatMUR(p.amountCents)}</span>
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
