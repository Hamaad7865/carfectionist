'use client';

import { formatMUR } from '@/lib/money';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  formatCompactMUR,
  type SalesPerformanceData,
  type SalesPoint,
} from './sales-performance';
import { SalesPeriodControls } from './SalesPeriodControls';

type TooltipEntry = { payload?: SalesPoint };

export function resolveSalesAxisDomain(
  dataMin: number,
  dataMax: number,
): [number, number] {
  if (dataMin === 0 && dataMax === 0) return [0, 100];
  return [Math.min(dataMin, 0), Math.max(dataMax, 0)];
}

function SalesTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const values = [
    ['Counter / direct', point.counterCents, '#2b8cff'],
    ['Workshop jobs', point.workshopCents, '#6a5cff'],
    ['Total incl. VAT', point.totalCents, '#1e6fe0'],
  ] as const;

  return (
    <div className="min-w-[210px] rounded-[12px] border border-line-2 bg-card p-3 shadow-xl">
      <div className="mb-2 text-[11.5px] font-bold text-ink">
        {point.fullLabel}
      </div>
      {values.map(([label, cents, color]) => (
        <div
          key={label}
          className="flex items-center gap-2 py-1 text-[11.5px]"
        >
          <span
            aria-hidden="true"
            className="size-2 rounded-sm"
            style={{ backgroundColor: color }}
          />
          <span className="flex-1 text-muted">{label}</span>
          <span className="num font-bold text-ink">{formatMUR(cents)}</span>
        </div>
      ))}
    </div>
  );
}

export function SalesPerformanceChart({
  data,
}: {
  data: SalesPerformanceData;
}) {
  const minPlotWidth =
    data.status === 'ready' ? Math.max(720, data.points.length * 38) : 720;

  return (
    <figure
      className="rounded-[15px] border border-line bg-card p-4 sm:p-5"
      aria-labelledby="sales-performance-title"
    >
      <figcaption className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <div
            id="sales-performance-title"
            className="font-display text-[15px] font-extrabold text-ink"
          >
            Sales performance
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted">
            Issued sales including VAT · {data.period.label}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex items-baseline gap-2 lg:flex-col lg:items-end lg:gap-0.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
              Total incl. VAT
            </div>
            <div className="num text-[18px] font-extrabold text-ink-strong">
              {data.status === 'ready' ? formatMUR(data.totalCents) : '—'}
            </div>
          </div>
          <SalesPeriodControls period={data.period} />
        </div>
      </figcaption>

      {data.status === 'unavailable' ? (
        <div className="mt-5 rounded-[12px] bg-sub px-4 py-12 text-center">
          <div className="text-[13px] font-bold text-body">
            Sales chart unavailable
          </div>
          <div className="mt-1 text-[11.5px] text-muted">
            Refresh the page to retry loading this period.
          </div>
        </div>
      ) : (
        <>
          {!data.hasSales && (
            <div className="mt-4 text-center text-[11.5px] text-faint">
              No issued sales in this period.
            </div>
          )}
          <div
            className="mt-3 overflow-x-auto pb-1 focus-visible:rounded-[10px]"
            role="region"
            aria-label="Sales chart plot"
            tabIndex={0}
          >
            <div
              style={{
                width: `max(100%, ${minPlotWidth}px)`,
                height: 360,
              }}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: minPlotWidth, height: 360 }}
              >
                <ComposedChart
                  data={data.points}
                  accessibilityLayer
                  margin={{ top: 12, right: 18, bottom: 48, left: 8 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="rgba(15,23,32,0.08)"
                    strokeDasharray="3 4"
                  />
                  <XAxis
                    dataKey="axisLabel"
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={64}
                    tick={{ fill: '#68737f', fontSize: 10 }}
                    axisLine={{ stroke: 'rgba(15,23,32,0.12)' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={([dataMin, dataMax]) =>
                      resolveSalesAxisDomain(dataMin, dataMax)
                    }
                    tickCount={data.hasSales ? 5 : 2}
                    tickFormatter={formatCompactMUR}
                    width={76}
                    tick={{ fill: '#68737f', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<SalesTooltip />}
                    cursor={{ fill: 'rgba(43,140,255,0.05)' }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={28}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="rgba(15,23,32,0.32)"
                    strokeWidth={1.2}
                  />
                  <Bar
                    dataKey="counterCents"
                    name="Counter / direct"
                    stackId="sales"
                    fill="#2b8cff"
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="workshopCents"
                    name="Workshop jobs"
                    stackId="sales"
                    fill="#6a5cff"
                    maxBarSize={28}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="totalCents"
                    name="Total incl. VAT"
                    type="monotone"
                    stroke="#1e6fe0"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: '#fff',
                      stroke: '#1e6fe0',
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <table className="sr-only">
            <caption>Sales including VAT by period and sales mode</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Counter or direct</th>
                <th scope="col">Workshop jobs</th>
                <th scope="col">Total including VAT</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((point) => (
                <tr key={point.key}>
                  <th scope="row">{point.fullLabel}</th>
                  <td>{formatMUR(point.counterCents)}</td>
                  <td>{formatMUR(point.workshopCents)}</td>
                  <td>{formatMUR(point.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </figure>
  );
}
