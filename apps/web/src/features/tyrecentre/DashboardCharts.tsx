"use client";

import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { InteractiveAreaChart, type AreaChartData } from "@/components/ui/interactive-area-chart";
import { DonutChart } from "@/components/ui/donut-chart";
import { formatMUR, formatMURShelf } from "@/lib/money";
import { formatCompactMUR } from "@/features/dashboard/sales-performance";
import type { TyreDashboardSeries } from "@/lib/supabase/queries/tyrecentre-dashboard";
import { dayToUtcMs, periodChange, runningTotal, shortDay, windowSums } from "./dashboard-series";

// Easy UI's charts take plain numbers; ours are rupees here (cents / 100).
const rupees = (cents: number) => cents / 100;
const fmtWhole = (n: number) => formatMURShelf(Math.round(n) * 100);
const fmtExact = (n: number) => formatMUR(Math.round(n * 100));
const fmtAxis = (n: number) => formatCompactMUR(Math.round(n * 100));
const fmtCount = (n: number) => String(Math.round(n));

const METHOD: Record<string, { label: string; color: string }> = {
  cash: { label: "Cash", color: "#0DA77C" },
  card: { label: "Card", color: "#0F1720" },
  juice: { label: "Juice", color: "#2B8CFF" },
  bank_transfer: { label: "Bank transfer", color: "#F5A623" },
  cheque: { label: "Cheque", color: "#9AA3AD" },
};

/** The last 30 days against the 30 before, as Easy UI stat cards. The sparkline is the running
 *  total across those 30 days, so it ends on the headline figure and never spikes. */
export function DashboardStats({ series, outstandingCents }: { series: TyreDashboardSeries; outstandingCents: number }) {
  const labels = series.days.slice(-30).map((d) => `up to ${shortDay(d)}`);
  const card = (data: number[], toValue: (n: number) => number) => {
    const w = windowSums(data, 30);
    return { value: toValue(w.current), previous: toValue(w.previous), trend: runningTotal(data.slice(-30)).map(toValue) };
  };
  const sales = card(series.salesCents, rupees);
  const collected = card(series.collectedCents, rupees);
  const invoices = card(series.invoiceCount, (n) => n);
  return (
    <div data-tour="stats">
      <StatGrid className="!gap-3.5">
      <StatCard label="Sales · last 30 days" {...sales} trendLabels={labels} period="vs the 30 days before" format={fmtWhole} color="#0F1720" className="!rounded-[22px]" />
      <StatCard label="Collected · last 30 days" {...collected} trendLabels={labels} period="vs the 30 days before" format={fmtWhole} color="#0DA77C" className="!rounded-[22px]" />
      <StatCard label="Invoices · last 30 days" {...invoices} trendLabels={labels} period="vs the 30 days before" format={fmtCount} color="#2B8CFF" className="!rounded-[22px]" />
      <StatCard
        label="Outstanding"
        value={rupees(outstandingCents)}
        trend={[]}
        period="owed to you right now"
        format={fmtWhole}
        color="#F5A623"
        className="!rounded-[22px]"
      />
    </StatGrid>
    </div>
  );
}

const RANGES: [string, number][] = [["7D", 7], ["30D", 30], ["90D", 90]];

/** Sales to date, incl. VAT, on Easy UI's interactive area chart — a white card in light mode and the
 *  reference's dark glass card in dark mode (the app's data-theme switch drives both). Each range
 *  is a running total from its first day, compared with the same number of days before it. */
export function SalesAreaChart({ series }: { series: TyreDashboardSeries }) {
  const data: AreaChartData = {};
  const compare: Record<string, number | null> = {};
  for (const [key, n] of RANGES) {
    const days = series.days.slice(-n);
    const totals = runningTotal(series.salesCents.slice(-n));
    data[key] = days.map((d, i) => ({ date: dayToUtcMs(d), value: rupees(totals[i]) }));
    compare[key] = periodChange(series.salesCents, n);
  }
  const days = Object.fromEntries(RANGES);
  return (
    <section
      aria-label="Sales"
      className="relative overflow-hidden rounded-[22px] bg-[#fff] p-5 text-neutral-900 shadow-tc-card ring-1 ring-black/[0.04] sm:p-6 dark:bg-[#0B0D10] dark:text-neutral-100 dark:shadow-[0_30px_60px_-32px_rgba(0,0,0,0.6)] dark:ring-white/[0.06]"
    >
      {/* Dark mode only: a faint top light, like the reference card's glass. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 hidden h-40 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(255,255,255,0.07),transparent)] dark:block" />
      <div className="relative">
        <InteractiveAreaChart
          data={data}
          defaultRange="30D"
          title="Sales to date · incl. VAT"
          compare={compare}
          caption={(r) => `vs the ${days[r]} days before`}
          formatValue={fmtExact}
          formatAxis={fmtAxis}
          height={300}
        />
      </div>
    </section>
  );
}
/** Payments by method on Easy UI's donut chart. */
export function MethodsDonut({ byMethod }: { byMethod: { method: string; cents: number }[] }) {
  const data = byMethod
    .filter((m) => m.cents > 0)
    .map((m) => ({ label: METHOD[m.method]?.label ?? m.method, value: rupees(m.cents), color: METHOD[m.method]?.color ?? "#C4CCD6" }));
  if (data.length === 0) return <div className="py-10 text-center text-[13.5px] text-tc-faint">No payments recorded yet.</div>;
  return <DonutChart data={data} centerLabel="Collected" formatValue={fmtWhole} size={190} ariaLabel="Payments by method" />;
}
