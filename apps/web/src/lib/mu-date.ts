// Mauritius is UTC+4 year-round (no DST). Postgres returns timestamptz as UTC
// ISO strings, so any calendar date/time we DISPLAY or bucket must be shifted to
// MU first — otherwise anything near local midnight lands on the wrong day.
export const MU_OFFSET_MS = 4 * 3600_000;

/** UTC ISO timestamp → "yyyy-mm-dd" in Mauritius local time. */
export function muDate(iso: string): string {
  return new Date(Date.parse(iso) + MU_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC ISO timestamp → "yyyy-mm-dd HH:MM" in Mauritius local time. */
export function muDateTime(iso: string): string {
  return new Date(Date.parse(iso) + MU_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** Today's calendar date in Mauritius ("yyyy-mm-dd"). */
export function muToday(): string {
  return new Date(Date.now() + MU_OFFSET_MS).toISOString().slice(0, 10);
}

/** A Date shifted so its UTC getters read Mauritius local fields. */
export function muNow(now = Date.now()): Date {
  return new Date(now + MU_OFFSET_MS);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * UTC ISO timestamp → "Thursday 17 July 2026" in Mauritius local time.
 * Hand-rolled (no Intl): the owner reads these headers, so they must render
 * identically on workerd and in the browser.
 */
export function muDayLabel(iso: string): string {
  const d = new Date(Date.parse(iso) + MU_OFFSET_MS);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
