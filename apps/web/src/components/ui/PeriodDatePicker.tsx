"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { muToday } from "@/lib/mu-date";

/**
 * Cashmag-style period picker — the "Period date" field from the owner's
 * Cashmag screenshots, rebuilt for the web app.
 *
 * Closed, it is one field: a small "Period date" caption over the value
 * ("4/9/2026 – 4/9/2026", day/month/year with no leading zeros) with a green
 * calendar icon on the right.
 *
 * Open, it is a two-level popup:
 *   • month level — a year label with < > steppers; the twelve months in a
 *     4-column JAN..DEC grid (the pending from/to months ride brand-blue
 *     pills); picking a month stages that whole month and drills into its days;
 *   • day level — a "MON YYYY" label (< > step months, click it to go back to
 *     the months), an S M T W T F S header and the day grid. First click sets
 *     the start day, second click the end day (an earlier second click swaps),
 *     a third click starts a new range. Endpoints print solid brand blue, the
 *     days between on a blue wash.
 *
 * Nothing is committed while picking: the range only reaches the caller when
 * the Validate button is pressed (one navigation for the whole gesture, not
 * one per click). Clear empties the range immediately.
 */

export interface DateRangeValue {
  from: string; // "yyyy-mm-dd" or ""
  to: string; // "yyyy-mm-dd" or ""
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Strict "yyyy-mm-dd" check — rejects 2026-02-30 and the like, timezone-free. */
export function isValidISODate(value: string): boolean {
  if (!ISO_RE.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonthYMD(y, m);
}

export function daysInMonthYMD(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-09-04" → "4/9/2026" — Cashmag's own day/month/year, no leading zeros. */
export function formatDMY(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;
}

/** The closed field's value line, or null when the range is empty. */
export function formatRangeLabel(from: string, to: string): string | null {
  const f = isValidISODate(from) ? formatDMY(from) : null;
  const t = isValidISODate(to) ? formatDMY(to) : null;
  if (f && t) return `${f} - ${t}`;
  return f ?? t;
}

function isoOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function partsOf(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/** Comparable month index — orders (year, month) pairs without a Date. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export function monthIndexOf(iso: string): number {
  const { y, m } = partsOf(iso);
  return monthIndex(y, m);
}

/** Step a (year, month) pair by whole months, e.g. Jan 2026 − 1 → Dec 2025. */
export function stepMonth(year: number, month: number, delta: number): { y: number; m: number } {
  const total = monthIndex(year, month) - 1 + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

/** Weekday (0 = Sunday) of the month's 1st, timezone-free. */
export function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export interface PendingRange {
  anchor: string | null; // staged start day (ISO) — the first click
  end: string | null; // staged end day (ISO) — the second click
}

/**
 * One day click: no anchor (or a finished range) stages the anchor and waits
 * for the second click; the second click closes the range, swapping when it
 * lands before the anchor.
 */
export function applyDayClick(pending: PendingRange, day: string): PendingRange {
  if (!pending.anchor || pending.end) return { anchor: day, end: null };
  if (day >= pending.anchor) return { anchor: pending.anchor, end: day };
  return { anchor: day, end: pending.anchor };
}

/**
 * One month click: with no staged anchor it stages that whole month; with one
 * it stretches the staged range to cover the clicked month too (a later month
 * moves the end, an earlier month moves the start, the same month re-stages
 * itself). Either way it drills into the clicked month for day-level
 * refinement — a day click is what restarts the staging.
 */
export function applyMonthClick(
  pending: PendingRange,
  year: number,
  month: number,
): PendingRange & { view: { y: number; m: number } } {
  const first = isoOf(year, month, 1);
  const last = isoOf(year, month, daysInMonthYMD(year, month));
  const view = { y: year, m: month };
  if (!pending.anchor) return { anchor: first, end: last, view };
  const clicked = monthIndex(year, month);
  const anchorMonth = monthIndexOf(pending.anchor);
  if (clicked > anchorMonth) return { anchor: pending.anchor, end: last, view };
  if (clicked < anchorMonth) return { anchor: first, end: pending.end ?? pending.anchor, view };
  return { anchor: first, end: last, view };
}

/** Pending staging → a committable { from, to } (single-day staging is valid). */
export function pendingToRange(pending: PendingRange): DateRangeValue {
  if (!pending.anchor) return { from: "", to: "" };
  return { from: pending.anchor, to: pending.end ?? pending.anchor };
}

export function PeriodDatePicker({
  from,
  to,
  onValidate,
  caption = "Period date",
  validateRange,
}: {
  from: string;
  to: string;
  onValidate: (range: DateRangeValue) => void;
  caption?: string;
  /** Return an error message to block Validate (e.g. the dashboard's 93-day cap). */
  validateRange?: (range: DateRangeValue) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "months">("days");
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const seed = [to, from].find(isValidISODate) ?? "2026-01-01";
    const { y, m } = partsOf(seed);
    return { y, m };
  });
  const [pending, setPending] = useState<PendingRange>({ anchor: null, end: null });
  const [error, setError] = useState<string | null>(null);

  // Fresh staging from the committed values every time the popup opens —
  // done in the open handler (not an effect), so opening never cascades.
  function openPopup() {
    const f = isValidISODate(from) ? from : null;
    const t = isValidISODate(to) ? to : null;
    setPending({ anchor: f, end: t });
    setError(null);
    setMode("days");
    const seed = t ?? f ?? muToday();
    const { y, m } = partsOf(seed);
    setView({ y, m });
    setOpen(true);
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const label = formatRangeLabel(from, to);
  const staged = pendingToRange(pending);
  const stagedLabel = formatRangeLabel(staged.from, staged.to);
  const hasCommitted = isValidISODate(from) || isValidISODate(to);

  function commit() {
    const range = pendingToRange(pending);
    if (validateRange) {
      const message = validateRange(range);
      if (message) {
        setError(message);
        return;
      }
    }
    setOpen(false);
    onValidate(range);
  }

  function clear() {
    setOpen(false);
    onValidate({ from: "", to: "" });
  }

  const anchorIdx = pending.anchor ? monthIndexOf(pending.anchor) : null;
  const endIdx = (pending.end ?? pending.anchor) ? monthIndexOf((pending.end ?? pending.anchor) as string) : null;
  const daysCount = daysInMonthYMD(view.y, view.m);
  const leadBlanks = firstWeekday(view.y, view.m);

  return (
    <div className="relative">
      {/* ── closed field ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopup())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${caption}${label ? `: ${label}` : ""}`}
        className={`flex min-w-[218px] items-center gap-3 rounded-[10px] border bg-card px-3.5 py-1.5 text-left outline-none transition-colors ${
          open ? "border-brand" : "border-line-2 hover:border-faint"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-medium leading-tight text-faint">{caption}</span>
          <span className={`num block truncate text-[14.5px] font-semibold leading-snug ${label ? "text-ink" : "text-fainter"}`}>
            {label ?? "Select period…"}
          </span>
        </span>
        <CalendarDays size={22} className="shrink-0 text-brand" strokeWidth={2.2} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label={caption}
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-[302px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-[14px] border border-line bg-card shadow-[0_24px_60px_-18px_rgba(15,23,32,0.4)]"
          >
            {/* ── header: year/month label + steppers ────────────── */}
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              {mode === "days" ? (
                <button
                  type="button"
                  onClick={() => setMode("months")}
                  aria-label="Choose month"
                  className="flex items-center gap-1 text-[14px] font-bold uppercase tracking-wide text-ink hover:text-link"
                >
                  {MONTHS_SHORT[view.m - 1]} {view.y}
                  <ChevronDown size={15} className="text-faint" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode("days")}
                  aria-label="Back to days"
                  className="flex items-center gap-1 text-[14px] font-bold text-ink hover:text-link"
                >
                  {view.y}
                  <ChevronDown size={15} className="rotate-180 text-faint" />
                </button>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={mode === "days" ? "Previous month" : "Previous year"}
                  onClick={() =>
                    mode === "days"
                      ? setView((v) => stepMonth(v.y, v.m, -1))
                      : setView((v) => ({ y: v.y - 1, m: v.m }))
                  }
                  className="grid size-8 place-items-center rounded-full text-body hover:bg-sub"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  aria-label={mode === "days" ? "Next month" : "Next year"}
                  onClick={() =>
                    mode === "days"
                      ? setView((v) => stepMonth(v.y, v.m, 1))
                      : setView((v) => ({ y: v.y + 1, m: v.m }))
                  }
                  className="grid size-8 place-items-center rounded-full text-body hover:bg-sub"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {mode === "months" ? (
              /* ── month grid ─────────────────────────────────── */
              <div className="px-4 pb-2 pt-3">
                <div className="pb-2 text-[12.5px] font-medium text-faint">{view.y}</div>
                <div className="grid grid-cols-4 gap-y-1">
                  {MONTHS_SHORT.map((name, i) => {
                    const m = i + 1;
                    const idx = monthIndex(view.y, m);
                    const lo = anchorIdx != null && endIdx != null ? Math.min(anchorIdx, endIdx) : null;
                    const hi = anchorIdx != null && endIdx != null ? Math.max(anchorIdx, endIdx) : null;
                    const selected = lo != null && hi != null && idx >= lo && idx <= hi;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          const next = applyMonthClick(pending, view.y, m);
                          setPending({ anchor: next.anchor, end: next.end });
                          setView(next.view);
                          setMode("days");
                          setError(null);
                        }}
                        aria-pressed={selected}
                        aria-label={`${MONTHS_LONG[i]} ${view.y}`}
                        className={`h-9 rounded-full text-[13px] font-semibold tracking-wide transition-colors ${
                          selected ? "bg-brand text-white" : "text-body hover:bg-sub"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* ── day grid ───────────────────────────────────── */
              <div className="px-4 pb-2 pt-3">
                <div className="grid grid-cols-7 pb-1 text-center text-[11.5px] font-medium text-faint">
                  {WEEKDAYS.map((w, i) => (
                    <span key={`${w}-${i}`}>{w}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-y-0.5">
                  {Array.from({ length: leadBlanks }, (_, i) => (
                    <span key={`blank-${i}`} />
                  ))}
                  {Array.from({ length: daysCount }, (_, i) => {
                    const day = isoOf(view.y, view.m, i + 1);
                    const lo = pending.anchor && (pending.end ?? pending.anchor)
                      ? [pending.anchor, pending.end ?? pending.anchor].sort()[0]
                      : null;
                    const hi = pending.anchor && (pending.end ?? pending.anchor)
                      ? [pending.anchor, pending.end ?? pending.anchor].sort()[1]
                      : null;
                    const isEndpoint = day === pending.anchor || (pending.end != null && day === pending.end);
                    const inRange = lo != null && hi != null && day > lo && day < hi;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          setPending((p) => applyDayClick(p, day));
                          setError(null);
                        }}
                        aria-pressed={isEndpoint}
                        aria-label={day}
                        className={`grid h-9 place-items-center text-[13px] transition-colors ${
                          isEndpoint
                            ? "rounded-full bg-brand font-bold text-white"
                            : inRange
                              ? "bg-[rgba(43,140,255,0.14)] font-semibold text-ink"
                              : "rounded-full font-medium text-body hover:bg-sub"
                        }`}
                      >
                        <span className="num">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── staged summary + error ───────────────────────── */}
            <div className="px-4 pt-1">
              {stagedLabel ? (
                <div className="num text-[12.5px] font-semibold text-muted">
                  {stagedLabel}
                </div>
              ) : (
                <div className="text-[12.5px] text-fainter">Pick a start day, then an end day.</div>
              )}
              {error && (
                <div role="alert" className="mt-1 text-[12.5px] font-semibold text-rose">
                  {error}
                </div>
              )}
            </div>

            {/* ── footer: Validate / Clear ─────────────────────── */}
            <div className="flex items-center gap-2 px-4 py-3">
              {(hasCommitted || pending.anchor) && (
                <button
                  type="button"
                  onClick={clear}
                  className="h-9 rounded-[10px] px-3 text-[13px] font-semibold text-muted hover:text-body"
                >
                  Clear
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={commit}
                className="h-9 rounded-[10px] bg-brand px-6 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90"
              >
                Validate
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
