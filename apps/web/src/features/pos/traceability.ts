import { MU_OFFSET_MS, muDateTime, muToday } from "@/lib/mu-date";

export const TRACE_LIMIT = 150;
export const TRACE_SOURCE_LIMIT = TRACE_LIMIT + 1;

export type TraceCategory = "payments" | "till" | "receipts" | "system";
export type TraceTone = "payment" | "till" | "receipt" | "system" | "warning";
export type TraceStatus =
  | "reversed"
  | "receipt_skipped"
  | "variance"
  | "disabled"
  | null;
export type TraceFilter = "all" | TraceCategory | "exceptions";

export interface TraceRangeInput {
  from?: string | string[];
  to?: string | string[];
}

export type TraceQueryParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export interface TraceEvent {
  key: string;
  at: string;
  atLabel: string;
  kind: string;
  category: TraceCategory;
  tone: TraceTone;
  status: TraceStatus;
  title: string;
  summary: string | null;
  actorName: string | null;
  amountCents: number | null;
  method: string | null;
  reference: string | null;
  reason: string | null;
  metadata: Array<{ label: string; value: string }>;
  href: string | null;
}

export interface NormalizedTraceRange {
  from: string;
  to: string;
  startIso: string;
  endExclusiveIso: string;
}

export interface TraceState {
  status: "ready" | "unavailable";
  capped: boolean;
  range: { from: string; to: string };
}

export interface DeviceTraceabilityData {
  trace: TraceEvent[];
  traceState: TraceState;
}

export interface TraceSummary {
  events: number;
  netPaymentsCents: number;
  receipts: number;
  exceptions: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 3600_000;
const TRACE_FILTERS = new Set<TraceFilter>([
  "all",
  "payments",
  "till",
  "receipts",
  "system",
  "exceptions",
]);

function validDate(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;

  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant)) return null;

  return new Date(instant).toISOString().slice(0, 10) === value ? value : null;
}

function mauritiusDayAt(now: number): string {
  return new Date(now + MU_OFFSET_MS).toISOString().slice(0, 10);
}

function mauritiusMidnightIso(day: string, dayOffset = 0): string {
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(utcMidnight + dayOffset * DAY_MS - MU_OFFSET_MS).toISOString();
}

export function normalizeTraceRange(
  input: TraceRangeInput,
  now?: number,
): NormalizedTraceRange {
  const fallback = now === undefined ? muToday() : mauritiusDayAt(now);
  const validFrom = validDate(input.from);
  const validTo = validDate(input.to);

  let from = validFrom ?? validTo ?? fallback;
  let to = validTo ?? validFrom ?? fallback;

  if (to < from) [from, to] = [to, from];

  return {
    from,
    to,
    startIso: mauritiusMidnightIso(from),
    endExclusiveIso: mauritiusMidnightIso(to, 1),
  };
}

export function resolveTraceFilter(
  value: string | readonly string[] | undefined,
): TraceFilter {
  return typeof value === "string" && TRACE_FILTERS.has(value as TraceFilter)
    ? (value as TraceFilter)
    : "all";
}

export function sortTraceEvents(events: readonly TraceEvent[]): TraceEvent[] {
  return [...events].sort((left, right) => {
    const timeOrder = Date.parse(right.at) - Date.parse(left.at);
    if (timeOrder !== 0) return timeOrder;
    if (left.key === right.key) return 0;
    return left.key > right.key ? -1 : 1;
  });
}

export function selectNewestTraceEvents(events: readonly TraceEvent[]): {
  events: TraceEvent[];
  capped: boolean;
} {
  const sorted = sortTraceEvents(events);
  return {
    events: sorted.slice(0, TRACE_LIMIT),
    capped: sorted.length > TRACE_LIMIT,
  };
}

export function filterTraceEvents(
  events: readonly TraceEvent[],
  filter: TraceFilter,
): TraceEvent[] {
  if (filter === "all") return [...events];
  if (filter === "exceptions") {
    return events.filter((event) => event.status !== null);
  }
  return events.filter((event) => event.category === filter);
}

export function summarizeTraceEvents(
  events: readonly TraceEvent[],
): TraceSummary {
  let netPaymentsCents = 0;
  let receipts = 0;
  let exceptions = 0;

  for (const event of events) {
    if (
      event.kind === "payment_received" ||
      event.kind === "payment_reversed"
    ) {
      netPaymentsCents += event.amountCents ?? 0;
    }
    if (
      event.kind === "receipt_printed" ||
      event.kind === "receipt_skipped" ||
      event.kind === "receipt_emailed"
    ) {
      receipts += 1;
    }
    if (event.status !== null) exceptions += 1;
  }

  return {
    events: events.length,
    netPaymentsCents,
    receipts,
    exceptions,
  };
}

export function groupTraceEventsByMauritiusDay(
  events: readonly TraceEvent[],
): Array<{ date: string; events: TraceEvent[] }> {
  const groups = new Map<string, TraceEvent[]>();

  for (const event of sortTraceEvents(events)) {
    const date = muDateTime(event.at).slice(0, 10);
    const group = groups.get(date);
    if (group) group.push(event);
    else groups.set(date, [event]);
  }

  return Array.from(groups, ([date, groupedEvents]) => ({
    date,
    events: groupedEvents,
  }));
}

export function buildTraceCategoryHref(
  currentQuery: TraceQueryParams,
  category: TraceFilter,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(currentQuery)) {
    if (typeof value === "string") query.append(key, value);
    else if (value !== undefined) {
      for (const item of value) query.append(key, item);
    }
  }

  query.set("tab", "trace");
  if (category === "all") query.delete("traceCategory");
  else query.set("traceCategory", category);

  return `?${query.toString()}`;
}
