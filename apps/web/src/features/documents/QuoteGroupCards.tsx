import Link from "next/link";
import { Printer } from "lucide-react";
import { formatMUR } from "@/lib/money";
import { StatusPill } from "@/components/ui/StatusPill";
import { entityVars, ENTITY } from "@/lib/tyrecentre/entity-colours";
import type { CheckoutBill } from "@/lib/supabase/queries/checkout";
import type { DocumentDetail } from "@/lib/supabase/queries/document";

/**
 * A quote split per company (tyre centre): every company's quote of the same visit, side by side —
 * its letterhead, lines, subtotal, VAT (or "VAT exempt") and total — and what the customer pays in
 * all. Each quote is its own numbered document; this only shows them together.
 */
export function QuoteGroupCards({
  currentId,
  parts,
}: {
  currentId: string;
  parts: { bill: CheckoutBill; doc: DocumentDetail }[];
}) {
  const combined = parts.reduce((s, p) => s + p.doc.totalCents, 0);
  return (
    <section aria-label="Quotes of this visit" className="@container flex min-w-0 flex-col gap-4 rounded-[15px] border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-muted">THIS VISIT</span>
        <span className="text-[16px] font-extrabold text-ink-strong">{parts.length} quotes, one per company</span>
      </div>

      <div className="grid gap-3.5 @[620px]:grid-cols-2">
        {parts.map(({ bill, doc }) => {
          const discountCents = doc.lineDiscountCents + doc.orderDiscountCents;
          return (
            <article
              key={bill.id}
              style={entityVars(bill.index)}
              className={`flex min-w-0 flex-col gap-3 rounded-[16px] border p-4 ${ENTITY.tint} ${ENTITY.border} ${bill.id === currentId ? "ring-1 ring-[var(--e-accent)]" : ""}`}
            >
              <div className="flex items-start gap-2.5">
                <span aria-hidden="true" className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] font-display text-[16px] font-bold ${ENTITY.soft} ${ENTITY.ink}`}>
                  {bill.companyName.trim().charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[14px] font-extrabold text-ink-strong">{bill.legalName}</span>
                  <span className="truncate font-mono text-[10.5px] text-muted">{bill.vatRegistered ? "VAT registered" : "not VAT registered"}</span>
                </div>
                {bill.id === currentId ? (
                  <span className={`num inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold ${ENTITY.dash} ${ENTITY.ink}`}>{bill.number}</span>
                ) : (
                  <Link href={`/sales/${bill.id}`} className={`num inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold hover:underline ${ENTITY.dash} ${ENTITY.ink}`}>
                    {bill.number}
                  </Link>
                )}
              </div>

              <div className={`flex flex-col border-t border-dashed pt-2 ${ENTITY.dash}`}>
                {doc.lines.map((l, i) => (
                  <div key={i} className="flex gap-2 py-1.5 text-[12.5px] text-body">
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                    <span className="num w-8 text-right text-muted">{l.qty}</span>
                    <span className="num w-[92px] text-right font-semibold text-ink">{formatMUR(l.amountCents).replace(/^Rs\s?/, "")}</span>
                  </div>
                ))}
              </div>

              <div className={`flex flex-col gap-1.5 border-t border-dashed pt-2.5 text-[12.5px] ${ENTITY.dash}`}>
                <div className="flex text-muted"><span className="flex-1">Subtotal</span><span className="num text-body">{formatMUR(doc.grossSubtotalCents + doc.lineDiscountCents)}</span></div>
                {discountCents > 0 && (
                  <div className="flex text-amber-ink"><span className="flex-1">Discount{doc.discountKind === "percent" && doc.orderDiscountCents > 0 ? ` ${doc.discountValue}%` : ""}</span><span className="num">− {formatMUR(discountCents)}</span></div>
                )}
                {bill.vatRegistered ? (
                  <div className="flex text-muted"><span className="flex-1">VAT</span><span className="num text-body">{formatMUR(doc.vatCents)}</span></div>
                ) : (
                  <div className="flex items-center text-muted">
                    <span className="flex-1">VAT</span>
                    <span className="inline-flex h-5 items-center rounded-full bg-shade/[0.06] px-2 text-[11px] font-bold text-body">VAT exempt</span>
                  </div>
                )}
                <div className="mt-1 flex items-baseline">
                  <span className="flex-1 text-[13px] font-bold text-ink">Total</span>
                  <span className="num font-display text-[22px] font-semibold tracking-[-0.4px] text-ink-strong">{formatMUR(doc.totalCents)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusPill status={doc.status} />
                <a
                  href={`/print/doc/${bill.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-dashed px-2.5 text-[12px] font-semibold ${ENTITY.dash} ${ENTITY.ink}`}
                >
                  <Printer size={13} /> Print / PDF
                </a>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
        {parts.map(({ bill, doc }) => (
          <div key={bill.id} style={entityVars(bill.index)} className="flex flex-col gap-1 rounded-[14px] border border-line bg-sub px-3.5 py-3">
            <span className="truncate text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{bill.companyName}</span>
            <span className={`num font-display text-[18px] font-semibold ${ENTITY.ink}`}>{formatMUR(doc.totalCents)}</span>
          </div>
        ))}
        <div className="flex flex-col gap-1 rounded-[14px] border border-[rgba(43,140,255,0.35)] bg-[linear-gradient(135deg,rgba(43,140,255,0.18),rgba(79,116,255,0.12))] px-3.5 py-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-body">Customer pays in all</span>
          <span className="num font-display text-[22px] font-semibold text-ink-strong">{formatMUR(combined)}</span>
        </div>
      </div>
    </section>
  );
}
