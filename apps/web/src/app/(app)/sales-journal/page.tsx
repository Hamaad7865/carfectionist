import { FileText } from "lucide-react";
import { Suspense } from "react";
import { getSalesJournalPage, getSalesJournal, getTradingName } from "@/lib/supabase/queries/sales-journal";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { muToday } from "@/lib/mu-date";
import { btn } from "@/components/ui/button";
import { SalesJournalView } from "@/features/sales-journal/SalesJournalView";
import { TicketPopup } from "@/features/tickets/TicketPopup";
import { EmailReceiptButton } from "@/features/tickets/EmailReceiptButton";
import { PeriodPicker } from "@/features/sales-journal/PeriodPicker";
import { MoreFiltersDialog } from "@/features/sales-journal/MoreFiltersDialog";
import { parseParams, toFilterState, toQuery, type RawParams } from "@/features/sales-journal/params";
import { comparisonRange } from "@/features/sales-journal/periods";

// Sales Journal — Cashmag's "Journal de ventes". One period, five breakdowns,
// all of them footing to the same totals. Server-rendered off the URL, like
// every other report in the app.

export default async function SalesJournalPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const today = muToday();
  const raw = await searchParams;
  const { range, compare, filters } = parseParams(raw, today);
  const prior = comparisonRange(compare, range);
  // The receipt modal — a document id, not report state: it rides the URL
  // beside the filters (like the sales page's ?t=) and never reaches the PDF.
  const receiptId = typeof raw.receipt === "string" && raw.receipt ? raw.receipt : undefined;

  const [{ journal, facets }, priorJournal, businessName, popup] = await Promise.all([
    getSalesJournalPage(range.from, range.to, filters),
    // The comparison runs the same query over the earlier window, with the same
    // filters — comparing a filtered period against an unfiltered one would be
    // meaningless.
    prior ? getSalesJournal(prior.from, prior.to, filters) : Promise.resolve(null),
    getTradingName(),
    receiptId ? getReceipt(receiptId) : Promise.resolve(null),
  ]);

  const baseQuery = toQuery({ range, compare, filters });
  const pdfHref = `/api/sales-journal/pdf?${baseQuery}`;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-line bg-sub px-5 py-3">
        <PeriodPicker range={range} today={today} compare={compare} />
        <div className="mx-1 h-6 w-px bg-line-2" />
        <MoreFiltersDialog facets={facets} current={toFilterState(filters)} />
        <div className="flex-1" />
        <a href={pdfHref} target="_blank" rel="noreferrer" className={btn("ghost", "sm")}>
          <FileText size={14} /> PDF file
        </a>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <SalesJournalView journal={journal} prior={priorJournal} priorRange={prior} businessName={businessName} query={baseQuery} />
      </div>

      {popup && receiptId && (
        <Suspense fallback={null}>
          <TicketPopup r={popup} docId={receiptId} param="receipt" emailSlot={<EmailReceiptButton docId={receiptId} defaultEmail={popup.customerEmail} />} />
        </Suspense>
      )}
    </div>
  );
}
