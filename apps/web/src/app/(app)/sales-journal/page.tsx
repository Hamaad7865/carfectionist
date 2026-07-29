import { FileText } from "lucide-react";
import { getSalesJournalPage, getSalesJournal, getTradingName } from "@/lib/supabase/queries/sales-journal";
import { muToday } from "@/lib/mu-date";
import { btn } from "@/components/ui/button";
import { SalesJournalView } from "@/features/sales-journal/SalesJournalView";
import { PeriodPicker } from "@/features/sales-journal/PeriodPicker";
import { MoreFiltersDialog } from "@/features/sales-journal/MoreFiltersDialog";
import { parseParams, toFilterState, toQuery, type RawParams } from "@/features/sales-journal/params";
import { comparisonRange } from "@/features/sales-journal/periods";

// Sales Journal — Cashmag's "Journal de ventes". One period, five breakdowns,
// all of them footing to the same totals. Server-rendered off the URL, like
// every other report in the app.

export default async function SalesJournalPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const today = muToday();
  const { range, compare, filters } = parseParams(await searchParams, today);
  const prior = comparisonRange(compare, range);

  const [{ journal, facets }, priorJournal, businessName] = await Promise.all([
    getSalesJournalPage(range.from, range.to, filters),
    // The comparison runs the same query over the earlier window, with the same
    // filters — comparing a filtered period against an unfiltered one would be
    // meaningless.
    prior ? getSalesJournal(prior.from, prior.to, filters) : Promise.resolve(null),
    getTradingName(),
  ]);

  const pdfHref = `/api/sales-journal/pdf?${toQuery({ range, compare, filters })}`;

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
        <SalesJournalView journal={journal} prior={priorJournal} priorRange={prior} businessName={businessName} />
      </div>
    </div>
  );
}
