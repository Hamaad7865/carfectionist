import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { formatMUR } from "@/lib/money";
import type { SupersededBill } from "@/lib/supabase/queries/document";

/**
 * A bill left standing on this document's revision line.
 *
 * The whole harm of the case this exists for is that nothing SAYS so: A00179 was
 * billed as INV-0204 across the counter, the quote was revised into A00180, and
 * from that moment the bill appeared on no page anyone opens — not the revision,
 * not the job — while the journal still counted its Rs 1,320 as revenue and the
 * customer still owed it. Staff could only find it by reading the database.
 *
 * So this says it in full: which bill, how much, whether it has been paid, and
 * which of the two ways out applies. Rendered on the quote, on the bill that
 * replaced it, and on the job — all three of the screens that were silent.
 */
export function SupersededBillNotice({ bills }: { bills: SupersededBill[] }) {
  if (bills.length === 0) return null;

  return (
    <div className="mt-4 rounded-[13px] border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.07)] p-4 text-amber-ink">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[rgba(245,166,35,0.16)]">
          <AlertTriangle size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-bold">
            {bills.length === 1 ? "An earlier bill is still standing" : `${bills.length} earlier bills are still standing`}
          </p>
          <p className="mt-1 text-[12px] leading-snug">
            Raised from a quotation this one replaced, and attached to no job — so it appears on no
            other screen, while it is still counted as revenue and still owed. Settle it before this
            work is billed, or the same goods are charged twice.
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {bills.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                <Link href={`/sales/${b.id}`} className="font-bold underline underline-offset-2">
                  {b.number ?? "Unnumbered bill"}
                </Link>
                <span className="num font-semibold">{formatMUR(b.totalCents)}</span>
                {b.quoteNumber && <span className="opacity-80">from {b.quoteNumber}</span>}
                <span className="opacity-80">
                  {/* Which door: a bill nobody has paid is voided; once money has changed
                      hands only a credit note is honest, and the RPC says the same. */}
                  {b.paidCents > 0 ? "· paid — credit it" : "· unpaid — void it"}
                </span>
                <Link href={`/sales/${b.id}`} className="inline-flex items-center gap-1 font-bold">
                  Open <ArrowRight size={13} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
