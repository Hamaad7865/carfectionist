import type { DotChart as DotChartData } from "@/features/tyrecentre/overview-model";
import { entityColours } from "@/lib/tyrecentre/entity-colours";

const PITCH = 14; // 10px dot + 4px gap
const DOT_R = 5;
const ROWS = 14;
const AXIS = 26;
const WIDTH = 760;

/** Entity 1 sells in black (spec §6.2); later companies in their accent. */
const dotFill = (companyIndex: number) => (companyIndex === 0 ? "#0F1720" : entityColours(companyIndex).accent);

/** Sales as dots, one per sale, stacked bottom-up per slot; booked jobs as outline dots;
 *  a black "now" line. A visually hidden table carries the same figures for screen readers. */
export function DotChart({ chart, companies, periodLabel }: { chart: DotChartData; companies: string[]; periodLabel: string }) {
  const n = chart.columns.length;
  const colW = WIDTH / n;
  const baseY = ROWS * PITCH;
  const height = baseY + AXIS;
  const cx = (i: number) => colW * (i + 0.5);
  const nowX = chart.nowPos == null ? null : chart.nowPos * colW;
  // Hour labels give way to the bold NOW label where they would collide.
  const hideLabel = (i: number) => nowX != null && Math.abs(cx(i) - nowX) < colW * 0.9;

  return (
    <figure className="min-w-0 flex-1">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto max-h-[240px] w-full" role="img" aria-label={`Sales ${periodLabel}, one dot per ${chart.perDot === 1 ? "sale" : `${chart.perDot} sales`}`}>
        {chart.columns.map((col, i) => {
          const sales = Array.from({ length: Math.ceil(col.sales.length / chart.perDot) }, (_, k) => col.sales[k * chart.perDot]);
          const booked = Math.ceil(col.booked / chart.perDot);
          return (
            <g key={col.key}>
              {sales.map((c, k) => (
                <circle key={`s${k}`} cx={cx(i)} cy={baseY - DOT_R - k * PITCH} r={DOT_R} fill={dotFill(c)} />
              ))}
              {Array.from({ length: booked }, (_, k) => (
                <circle
                  key={`b${k}`}
                  cx={cx(i)}
                  cy={baseY - DOT_R - (sales.length + k) * PITCH}
                  r={DOT_R - 0.75}
                  fill="none"
                  stroke="#C4CCD6"
                  strokeWidth={1.5}
                />
              ))}
              {col.label && !hideLabel(i) && (
                <text x={cx(i)} y={baseY + 18} textAnchor="middle" className="fill-tc-fainter font-mono text-[10px]">
                  {col.label}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={WIDTH} y1={baseY + 4} y2={baseY + 4} stroke="rgba(15,23,32,0.07)" />
        {nowX != null && (
          <>
            <line x1={nowX} x2={nowX} y1={0} y2={baseY + 4} stroke="#0F1720" strokeWidth={2} />
            <text x={nowX} y={baseY + 18} textAnchor="middle" className="fill-tc-ink font-mono text-[10px] font-bold">
              NOW {chart.nowLabel}
            </text>
          </>
        )}
      </svg>
      {chart.perDot > 1 && <figcaption className="tc-mono mt-1 text-right text-[10px] text-tc-fainter">1 dot = {chart.perDot} sales</figcaption>}
      <table className="sr-only">
        <caption>Sales {periodLabel} by slot{companies.length ? ` (${companies.join(", ")})` : ""}</caption>
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col">Sales</th>
            <th scope="col">Booked</th>
          </tr>
        </thead>
        <tbody>
          {chart.columns.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.label || c.key}</th>
              <td>{c.sales.length}</td>
              <td>{c.booked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
