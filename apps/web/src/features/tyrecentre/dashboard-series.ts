import { muDate } from "@/lib/mu-date";

const DAY_MS = 86_400_000;

/** The last `days` Mauritius calendar days ending today, oldest first ("yyyy-mm-dd"). */
export function muDayKeys(nowMs: number, days: number): string[] {
  const today = Date.parse(`${muDate(new Date(nowMs).toISOString())}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Sum `value` per Mauritius day onto `keys`; rows outside them are ignored. */
export function bucketByDay(keys: string[], rows: { at: string; value: number }[]): number[] {
  const index = new Map(keys.map((k, i) => [k, i]));
  const out = new Array<number>(keys.length).fill(0);
  for (const r of rows) {
    const i = index.get(muDate(r.at));
    if (i !== undefined) out[i] += r.value;
  }
  return out;
}

/** The last `n` points summed, and the `n` before them — a stat card's value and its baseline. */
export function windowSums(series: number[], n: number): { current: number; previous: number } {
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  return { current: sum(series.slice(-n)), previous: sum(series.slice(-2 * n, -n)) };
}

/** Running total — "to date" across a period, so a lumpy day reads as a step, not a spike. */
export function runningTotal(series: number[]): number[] {
  let acc = 0;
  return series.map((v) => (acc += v));
}

/** The last `n` days against the `n` before, as a fraction (0.124 = +12.4%); null when the
 *  earlier period had nothing to compare with or the series doesn't reach back that far. */
export function periodChange(series: number[], n: number): number | null {
  if (series.length < 2 * n) return null;
  const { current, previous } = windowSums(series, n);
  return previous > 0 ? (current - previous) / previous : null;
}

/** A "yyyy-mm-dd" day as the UTC-midnight instant chart components label in UTC. */
export const dayToUtcMs = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** "12 Nov" — a sparkline point's name while scrubbing. */
export function shortDay(key: string): string {
  const d = new Date(dayToUtcMs(key));
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}
