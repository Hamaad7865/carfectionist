// Period presets and comparison ranges for the Sales Journal, mirroring
// Cashmag's two dropdowns. Pure date arithmetic on "yyyy-mm-dd" strings — no
// Date-with-local-timezone anywhere, because the app's calendar day is Mauritius
// (UTC+4) and a host-local Date would silently shift the boundary.

export type PresetKey = "today" | "yesterday" | "current-month" | "previous-month" | "custom";
export type CompareKey = "none" | "previous-period" | "previous-month" | "previous-year";

export interface Range {
  from: string;
  to: string;
}

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "custom", label: "Custom period" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "current-month", label: "Current month" },
  { key: "previous-month", label: "Previous month" },
];

export const COMPARISONS: { key: CompareKey; label: string }[] = [
  { key: "none", label: "Do not compare" },
  { key: "previous-period", label: "Previous period" },
  { key: "previous-month", label: "Previous month" },
  { key: "previous-year", label: "Previous year" },
];

const DAY_MS = 86_400_000;

/** "yyyy-mm-dd" → the three numbers, no Date involved. */
function parts(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shift a calendar day by whole days. */
export function addDays(day: string, n: number): string {
  const d = new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/** Inclusive length of a range, in days. */
export function lengthInDays(r: Range): number {
  return Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * Shift a calendar day by whole months/years, clamping to the target month's
 * length: 31 March a month back is 28 (or 29) February, not 3 March.
 */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = parts(day);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** The range a preset resolves to, relative to `today` (a Mauritius calendar day). */
export function rangeForPreset(key: PresetKey, today: string, current?: Range): Range {
  const [y, m] = parts(today);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "current-month":
      return { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) };
    case "previous-month": {
      const p = addMonths(iso(y, m, 1), -1);
      const [py, pm] = parts(p);
      return { from: p, to: iso(py, pm, daysInMonth(py, pm)) };
    }
    case "custom":
      return current ?? { from: today, to: today };
  }
}

/** Which preset a range corresponds to — so the dropdown reflects the URL. */
export function presetForRange(r: Range, today: string): PresetKey {
  for (const p of PRESETS) {
    if (p.key === "custom") continue;
    const candidate = rangeForPreset(p.key, today);
    if (candidate.from === r.from && candidate.to === r.to) return p.key;
  }
  return "custom";
}

/**
 * The range to compare against. `previous-period` is the window of the same
 * length ending the day before the range starts; the other two shift the same
 * dates back a month or a year.
 */
export function comparisonRange(key: CompareKey, r: Range): Range | null {
  switch (key) {
    case "none":
      return null;
    case "previous-period": {
      const to = addDays(r.from, -1);
      return { from: addDays(to, -(lengthInDays(r) - 1)), to };
    }
    case "previous-month":
      return { from: addMonths(r.from, -1), to: addMonths(r.to, -1) };
    case "previous-year":
      return { from: addMonths(r.from, -12), to: addMonths(r.to, -12) };
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "28 JULY 2026 – 29 JULY 2026", or a single date when the range is one day. */
export function rangeLabel(r: Range): string {
  const one = (day: string) => {
    const [y, m, d] = parts(day);
    return `${d} ${MONTHS[m - 1].toUpperCase()} ${y}`;
  };
  return r.from === r.to ? one(r.from) : `${one(r.from)} – ${one(r.to)}`;
}

/** "26 Jul – 27 Jul 2026", the compact form used beside the comparison options. */
export function shortRangeLabel(r: Range): string {
  const one = (day: string, withYear: boolean) => {
    const [y, m, d] = parts(day);
    return `${d} ${MONTHS[m - 1].slice(0, 3)}${withYear ? ` ${y}` : ""}`;
  };
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  return r.from === r.to ? one(r.from, true) : `${one(r.from, !sameYear)} – ${one(r.to, true)}`;
}
