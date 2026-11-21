import { MU_OFFSET_MS } from "@/lib/mu-date";

/** The Overview's Today / 7 days / 30 days toggle (`?range=`). */
export type OverviewRange = "today" | "7d" | "30d";

export function normalizeRange(v: string | string[] | undefined): OverviewRange {
  return v === "7d" || v === "30d" ? v : "today";
}

const DAY_MS = 86_400_000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Mauritius-local fields of an instant (UTC getters on a shifted Date). */
const mu = (ms: number) => new Date(ms + MU_OFFSET_MS);

/** Midnight (Mauritius) of the day holding `ms`, as an instant. */
export function muDayStartMs(ms: number): number {
  const d = mu(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - MU_OFFSET_MS;
}

export interface OverviewWindow {
  startMs: number;
  endMs: number;
  prevStartMs: number;
  prevEndMs: number;
  /** "vs last Saturday" — what the % badge compares against. */
  compareLabel: string;
}

/** Today runs to now and compares with the same stretch of the same weekday last week;
 *  7 and 30 days end now and compare with the period just before. */
export function overviewWindow(range: OverviewRange, nowMs: number): OverviewWindow {
  const dayStart = muDayStartMs(nowMs);
  if (range === "today") {
    return {
      startMs: dayStart,
      endMs: nowMs,
      prevStartMs: dayStart - 7 * DAY_MS,
      prevEndMs: nowMs - 7 * DAY_MS,
      compareLabel: `vs last ${DAYS[mu(nowMs).getUTCDay()]}`,
    };
  }
  const days = range === "7d" ? 7 : 30;
  const startMs = dayStart - (days - 1) * DAY_MS;
  return { startMs, endMs: nowMs, prevStartMs: startMs - days * DAY_MS, prevEndMs: startMs, compareLabel: `vs the ${days} days before` };
}

/** Change against the comparison period, one decimal. Null when there is nothing to compare
 *  with — a percentage of zero is not a number worth printing. */
export function percentChange(currentCents: number, previousCents: number): number | null {
  if (previousCents <= 0) return null;
  return Math.round(((currentCents - previousCents) / previousCents) * 1000) / 10;
}

export interface DotColumn {
  key: string;
  label: string;
  /** One entry per sale, oldest first: the issuing company's sort index (its colour). */
  sales: number[];
  /** Booked jobs still to come in this slot — drawn as outline dots. */
  booked: number;
}

export interface DotChart {
  columns: DotColumn[];
  /** How many sales one dot stands for (1 unless a column would overflow the chart). */
  perDot: number;
  /** Where the "now" line sits, in column widths from the left edge; null = no line. */
  nowPos: number | null;
  nowLabel: string | null;
}

export interface SaleDot {
  atMs: number;
  companyIndex: number;
}

const hh = (n: number) => String(n).padStart(2, "0");

/** One column per hour (today) or per day (7/30 days); each sale is a dot, stacked
 *  bottom-up. Hours run 08–18 unless the day's sales or bookings reach further. */
export function buildDotChart(
  range: OverviewRange,
  win: OverviewWindow,
  sales: SaleDot[],
  bookedMs: number[],
  nowMs: number,
  maxStack = 14,
): DotChart {
  const sorted = [...sales].sort((a, b) => a.atMs - b.atMs);
  let columns: DotColumn[];
  let nowPos: number | null = null;
  let nowLabel: string | null = null;

  if (range === "today") {
    const hourOf = (ms: number) => mu(ms).getUTCHours();
    const hours = [...sorted.map((s) => hourOf(s.atMs)), ...bookedMs.map(hourOf)];
    const first = Math.min(8, ...hours);
    const last = Math.max(18, ...hours);
    columns = [];
    for (let h = first; h <= last; h++) columns.push({ key: `h${h}`, label: hh(h), sales: [], booked: 0 });
    for (const s of sorted) columns[hourOf(s.atMs) - first].sales.push(s.companyIndex);
    for (const b of bookedMs) if (b > nowMs) columns[hourOf(b) - first].booked += 1;
    const n = mu(nowMs);
    nowPos = Math.min(columns.length, Math.max(0, n.getUTCHours() - first + n.getUTCMinutes() / 60 + 0.5));
    nowLabel = `${hh(n.getUTCHours())}:${hh(n.getUTCMinutes())}`;
  } else {
    const days = Math.round((muDayStartMs(win.endMs) - win.startMs) / DAY_MS) + 1;
    columns = Array.from({ length: days }, (_, i) => {
      const d = mu(win.startMs + i * DAY_MS);
      const label =
        i === days - 1
          ? "TODAY"
          : range === "7d"
            ? DAYS[d.getUTCDay()].slice(0, 3).toUpperCase()
            : i % 5 === 0
              ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].toUpperCase()}`
              : "";
      return { key: `d${i}`, label, sales: [], booked: 0 };
    });
    for (const s of sorted) {
      const i = Math.floor((muDayStartMs(s.atMs) - win.startMs) / DAY_MS);
      if (i >= 0 && i < columns.length) columns[i].sales.push(s.companyIndex);
    }
  }

  const tallest = Math.max(0, ...columns.map((c) => c.sales.length + c.booked));
  return { columns, perDot: Math.max(1, Math.ceil(tallest / maxStack)), nowPos, nowLabel };
}

/** The header's mono date line: "Saturday, 21 November · 13:54". */
export function overviewDateLine(nowMs: number): string {
  const d = mu(nowMs);
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()];
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${month} · ${hh(d.getUTCHours())}:${hh(d.getUTCMinutes())}`;
}

/** "08:02" — Mauritius clock time of an instant. */
export function muClock(ms: number): string {
  const d = mu(ms);
  return `${hh(d.getUTCHours())}:${hh(d.getUTCMinutes())}`;
}

export function muWeekday(ms: number): string {
  return DAYS[mu(ms).getUTCDay()];
}
