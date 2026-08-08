/**
 * Is this the till being refused because the trading day was sealed — the one refusal a
 * reopen actually fixes?
 *
 * Matches `app.open_trading_day`, which names the date: "the day of 2026-08-08 is closed
 * — reopen it before taking any more money". Deliberately narrower than "is closed": a
 * till left open since yesterday, a quotation-only device and a closed session each
 * refuse with their own wording and their own fix, and offering to reopen the day for
 * those points staff at a button that cannot help them.
 *
 * Mirrors `isDayClosed` in the Android TillScreen — keep the two in step.
 */
export function isDayClosed(error: string | null | undefined): boolean {
  if (!error) return false;
  const m = error.toLowerCase();
  return m.includes("is closed") && m.includes("reopen it");
}
