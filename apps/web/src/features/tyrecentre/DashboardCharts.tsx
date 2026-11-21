"use client";

import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { InteractiveAreaChart, type AreaChartData } from "@/components/ui/interactive-area-chart";
import { DonutChart } from "@/components/ui/donut-chart";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { formatMUR, formatMURShelf } from "@/lib/money";
import { formatCompactMUR } from "@/features/dashboard/sales-performance";
import type { TyreDashboardSeries } from "@/lib/supabase/queries/tyrecentre-dashboard";
import { dayToUtcMs, shortDay, windowSums } from "./dashboard-series";

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

/** The last 30 days against the 30 before, as Easy UI stat cards with a 30-day sparkline. */
export function DashboardStats({ series, outstandingCents }: { series: TyreDashboardSeries; outstandingCents: number }) {
  const labels = series.days.slice(-30).map(shortDay);
  const card = (data: number[], toValue: (n: number) => number) => {
    const w = windowSums(data, 30);
    return { value: toValue(w.current), previous: toValue(w.previous), trend: data.slice(-30).map(toValue) };
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

/** Daily sales, incl. VAT, on Easy UI's interactive area chart (7 / 30 / 90 days). */
export function SalesAreaChart({ series }: { series: TyreDashboardSeries }) {
  const pts = series.days.map((d, i) => ({ date: dayToUtcMs(d), value: rupees(series.salesCents[i]) }));
  const data: AreaChartData = { "7D": pts.slice(-7), "30D": pts.slice(-30), "90D": pts };
  return (
    <TcCard className="p-5 sm:p-[22px]" aria-label="Sales">
      <InteractiveAreaChart data={data} defaultRange="30D" title="Sales incl. VAT" headline="sum" formatValue={fmtExact} formatAxis={fmtAxis} height={260} />
    </TcCard>
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
