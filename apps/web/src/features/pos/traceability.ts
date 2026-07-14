import { MU_OFFSET_MS, muDateTime, muToday } from "@/lib/mu-date";
import { rupeesToCents } from "@/lib/money";

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

export interface TraceAuditRow {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
  actor_id: string | null;
  ref_id: string | null;
}

export interface TracePaymentRow {
  id: string;
  cash_session_id: string | null;
  document_id: string;
  method: string;
  amount: number | string;
  received_at: string;
  received_by: string | null;
  reverses_payment_id: string | null;
  documents: {
    id: string;
    number: string | null;
    discount_kind: string | null;
    discount_value: number | string | null;
  } | null;
}

export interface TraceSessionRow {
  id: string;
  device_id: string;
  opened_at: string;
  opened_by: string | null;
  opening_float: number | string;
  closed_at: string | null;
  closed_by: string | null;
  expected_cash: number | string | null;
  closing_count: number | string | null;
  variance: number | string | null;
}

export type TraceReversalAuditRow = TraceAuditRow;

export interface TraceDiscountLineRow {
  id: string;
  document_id: string;
  title: string;
  discount_pct: number | string | null;
  discount_kind: string | null;
  discount_amount: number | string | null;
}

export interface TraceActorRow {
  id: string;
  display_name: string;
}

export interface TraceSessionPaymentRow {
  id: string;
  cash_session_id: string | null;
  method: string;
  amount: number | string;
}

export interface TraceMapperContext {
  actorNames: ReadonlyMap<string, string>;
  documentIdsByNumber: ReadonlyMap<string, string>;
  reversalAudits: readonly TraceReversalAuditRow[];
  sessionPayments: readonly TraceSessionPaymentRow[];
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

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function moneyCents(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric === null ? null : rupeesToCents(numeric);
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function auditPayload(payload: unknown): Record<string, unknown> {
  return payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function humanize(value: string): string {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized === ""
    ? "Unknown event"
    : `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
}

const METHOD_LABELS: ReadonlyMap<string, string> = new Map([
  ["bank_transfer", "Bank transfer"],
  ["card", "Card"],
  ["cash", "Cash"],
  ["juice", "Juice"],
]);

const CHANNEL_LABELS: ReadonlyMap<string, string> = new Map([
  ["email", "Email"],
  ["whatsapp", "WhatsApp"],
]);

function methodLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return METHOD_LABELS.get(normalized) ?? humanize(normalized);
}

function channelLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return CHANNEL_LABELS.get(normalized) ?? humanize(normalized);
}

function createTraceEvent(
  key: string,
  at: string,
  overrides: Omit<Partial<TraceEvent>, "key" | "at" | "atLabel">,
): TraceEvent {
  return {
    key,
    at,
    atLabel: Number.isFinite(Date.parse(at)) ? muDateTime(at) : at,
    kind: "unknown_event",
    category: "system",
    tone: "system",
    status: null,
    title: "Unknown event",
    summary: null,
    actorName: null,
    amountCents: null,
    method: null,
    reference: null,
    reason: null,
    metadata: [],
    href: null,
    ...overrides,
  };
}

function actorName(
  actorId: string | null,
  context: TraceMapperContext,
): string | null {
  return actorId === null
    ? null
    : scalarText(context.actorNames.get(actorId));
}

function documentHref(documentId: unknown): string | null {
  const id = scalarText(documentId);
  return id === null ? null : `/sales/${encodeURIComponent(id)}`;
}

function receiptHref(
  row: TraceAuditRow,
  reference: string | null,
  context: TraceMapperContext,
  trustsRefId: boolean,
): string | null {
  if (trustsRefId) {
    const directHref = documentHref(row.ref_id);
    if (directHref !== null) return directHref;
  }

  return reference === null
    ? null
    : documentHref(context.documentIdsByNumber.get(reference));
}

function formatMetadataMoney(cents: number): string {
  return `Rs ${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercentage(value: number): string {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 4,
  })}%`;
}

export function mapAuditTraceEvent(
  row: TraceAuditRow,
  context: TraceMapperContext,
): TraceEvent | null {
  if (
    row.event_type === "payment_reversed" ||
    row.event_type === "period_closed"
  ) {
    return null;
  }

  const payload = auditPayload(row.payload);
  const byName = actorName(row.actor_id, context);
  const key = `audit:${row.id}`;

  switch (row.event_type) {
    case "terminal_started": {
      const metadata: TraceEvent["metadata"] = [];
      const model = scalarText(payload.model);
      const version = scalarText(payload.app_version);
      if (model !== null) metadata.push({ label: "Model", value: model });
      if (version !== null) {
        metadata.push({ label: "App version", value: version });
      }
      return createTraceEvent(key, row.created_at, {
        kind: "terminal_started",
        title: "Terminal started",
        actorName: byName,
        metadata,
      });
    }
    case "app_version_changed": {
      const metadata: TraceEvent["metadata"] = [];
      const previous = scalarText(payload.from);
      const next = scalarText(payload.to);
      if (previous !== null) {
        metadata.push({ label: "Previous version", value: previous });
      }
      if (next !== null) {
        metadata.push({ label: "New version", value: next });
      }
      return createTraceEvent(key, row.created_at, {
        kind: "version_changed",
        title: "App version changed",
        actorName: byName,
        metadata,
      });
    }
    case "signed_in":
      return createTraceEvent(key, row.created_at, {
        kind: "operator_signed_in",
        title: "Operator signed in",
        actorName: byName,
      });
    case "device_enabled":
      return createTraceEvent(key, row.created_at, {
        kind: "device_enabled",
        title: "Device enabled",
        actorName: byName,
      });
    case "device_disabled":
      return createTraceEvent(key, row.created_at, {
        kind: "device_disabled",
        tone: "warning",
        status: "disabled",
        title: "Device disabled",
        actorName: byName,
        reason: scalarText(payload.reason),
      });
    case "till_cash_out": {
      const cents = moneyCents(payload.amount);
      return createTraceEvent(key, row.created_at, {
        kind: "cash_out",
        category: "till",
        tone: "till",
        title: "Cash out",
        actorName: byName,
        amountCents: cents === null ? null : -Math.abs(cents),
        reason: scalarText(payload.reason),
      });
    }
    case "receipt_printed": {
      const reference = scalarText(payload.number);
      return createTraceEvent(key, row.created_at, {
        kind: "receipt_printed",
        category: "receipts",
        tone: "receipt",
        title: "Receipt printed",
        reference,
        href: receiptHref(row, reference, context, false),
      });
    }
    case "receipt_skipped": {
      const reference = scalarText(payload.number);
      return createTraceEvent(key, row.created_at, {
        kind: "receipt_skipped",
        category: "receipts",
        tone: "warning",
        status: "receipt_skipped",
        title: "Receipt skipped",
        reference,
        href: receiptHref(row, reference, context, false),
      });
    }
    case "receipt_emailed": {
      const reference = scalarText(payload.number);
      const recipient = scalarText(payload.to);
      return createTraceEvent(key, row.created_at, {
        kind: "receipt_emailed",
        category: "receipts",
        tone: "receipt",
        title: "Receipt emailed",
        actorName: byName,
        reference,
        metadata:
          recipient === null
            ? []
            : [{ label: "Recipient", value: recipient }],
        href: receiptHref(row, reference, context, true),
      });
    }
    case "document_sent": {
      const reference = scalarText(payload.number);
      const channel = scalarText(payload.channel);
      const recipient = scalarText(payload.to);
      const metadata: TraceEvent["metadata"] = [];
      if (channel !== null) {
        metadata.push({ label: "Channel", value: channelLabel(channel) });
      }
      if (recipient !== null) {
        metadata.push({ label: "Recipient", value: recipient });
      }
      return createTraceEvent(key, row.created_at, {
        kind: "document_sent",
        category: "receipts",
        tone: "receipt",
        title: "Document sent",
        actorName: byName,
        reference,
        metadata,
        href: receiptHref(row, reference, context, true),
      });
    }
    case "data_export": {
      const metadata: TraceEvent["metadata"] = [];
      const report = scalarText(payload.report);
      const from = scalarText(payload.from);
      const to = scalarText(payload.to);
      if (report !== null) metadata.push({ label: "Report", value: report });
      if (from !== null) metadata.push({ label: "From", value: from });
      if (to !== null) metadata.push({ label: "To", value: to });
      return createTraceEvent(key, row.created_at, {
        kind: "data_export",
        title: "Data exported",
        actorName: byName,
        metadata,
      });
    }
    default: {
      const kind = scalarText(row.event_type) ?? "unknown_event";
      return createTraceEvent(key, row.created_at, {
        kind,
        title: humanize(kind),
        actorName: byName,
      });
    }
  }
}

export function mapPaymentTraceEvent(
  row: TracePaymentRow,
  context: TraceMapperContext,
): TraceEvent {
  const numericAmount = finiteNumber(row.amount);
  const amountCents = moneyCents(row.amount);
  const isReversal = numericAmount !== null && numericAmount < 0;
  const reversalAudit = isReversal && row.reverses_payment_id !== null
    ? context.reversalAudits.find(
        (audit) => audit.ref_id === row.reverses_payment_id,
      )
    : undefined;
  const reversalReason = reversalAudit
    ? scalarText(auditPayload(reversalAudit.payload).reason)
    : null;
  const document =
    row.documents?.id === row.document_id ? row.documents : null;
  const rawMethod = scalarText(row.method);

  return createTraceEvent(`payment:${row.id}`, row.received_at, {
    kind: isReversal ? "payment_reversed" : "payment_received",
    category: "payments",
    tone: isReversal ? "warning" : "payment",
    status: isReversal ? "reversed" : null,
    title: isReversal ? "Payment reversed" : "Payment received",
    actorName: actorName(
      reversalAudit?.actor_id ?? row.received_by,
      context,
    ),
    amountCents,
    method: rawMethod === null ? null : methodLabel(rawMethod),
    reference: scalarText(document?.number),
    reason: isReversal ? (reversalReason ?? "Reason unavailable") : null,
    href: documentHref(row.document_id),
  });
}

export function mapSessionOpenTraceEvent(
  row: TraceSessionRow,
  context: TraceMapperContext,
): TraceEvent {
  const openingFloatCents = moneyCents(row.opening_float);
  return createTraceEvent(`session-open:${row.id}`, row.opened_at, {
    kind: "till_opened",
    category: "till",
    tone: "till",
    title: "Till opened",
    actorName: actorName(row.opened_by, context),
    amountCents:
      openingFloatCents === null ? null : Math.abs(openingFloatCents),
    metadata: [{ label: "Session ID", value: row.id }],
  });
}

export function mapSessionCloseTraceEvent(
  row: TraceSessionRow,
  context: TraceMapperContext,
): TraceEvent | null {
  if (scalarText(row.closed_at) === null) return null;

  const varianceCents = moneyCents(row.variance);
  const hasVariance = varianceCents !== null && varianceCents !== 0;
  const metadata: TraceEvent["metadata"] = [];
  const expectedCents = moneyCents(row.expected_cash);
  const countedCents = moneyCents(row.closing_count);
  if (expectedCents !== null) {
    metadata.push({
      label: "Expected cash",
      value: formatMetadataMoney(expectedCents),
    });
  }
  if (countedCents !== null) {
    metadata.push({
      label: "Counted cash",
      value: formatMetadataMoney(countedCents),
    });
  }

  const nonCashTotals = new Map<string, number>();
  for (const payment of context.sessionPayments) {
    if (payment.cash_session_id !== row.id) continue;
    const method = scalarText(payment.method)?.toLowerCase() ?? null;
    const cents = moneyCents(payment.amount);
    if (method === null || method === "cash" || cents === null) continue;
    nonCashTotals.set(method, (nonCashTotals.get(method) ?? 0) + cents);
  }
  for (const [method, cents] of [...nonCashTotals.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    metadata.push({
      label: `${methodLabel(method)} total`,
      value: formatMetadataMoney(cents),
    });
  }

  return createTraceEvent(
    `session-close:${row.id}`,
    row.closed_at as string,
    {
      kind: "till_closed",
      category: "till",
      tone: hasVariance ? "warning" : "till",
      status: hasVariance ? "variance" : null,
      title: "Till closed",
      actorName: actorName(row.closed_by, context),
      amountCents: varianceCents,
      metadata,
    },
  );
}

function discountMetadataValue(
  kind: string | null,
  percentValue: unknown,
  amountValue: unknown,
): string | null {
  if (kind === "amount") {
    const cents = moneyCents(amountValue);
    return cents !== null && cents > 0 ? formatMetadataMoney(cents) : null;
  }

  const percent = finiteNumber(percentValue);
  return percent !== null && percent > 0 ? formatPercentage(percent) : null;
}

export function mapDiscountTraceEvent(
  documentId: string,
  canonicalPayments: readonly TracePaymentRow[],
  discountLines: readonly TraceDiscountLineRow[],
  context: TraceMapperContext,
): TraceEvent | null {
  const payments = canonicalPayments
    .filter((payment) => {
      const amount = finiteNumber(payment.amount);
      return (
        payment.document_id === documentId &&
        amount !== null &&
        amount > 0 &&
        Number.isFinite(Date.parse(payment.received_at))
      );
    })
    .sort((left, right) => {
      if (left.received_at !== right.received_at) {
        return left.received_at < right.received_at ? -1 : 1;
      }
      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
  const canonical = payments[0];
  if (canonical === undefined) return null;

  const document =
    canonical.documents?.id === documentId
      ? canonical.documents
      : payments.find((payment) => payment.documents?.id === documentId)
          ?.documents ?? null;
  const metadata: TraceEvent["metadata"] = [];
  if (document?.discount_kind !== null && document?.discount_kind !== undefined) {
    const wholeSaleValue = discountMetadataValue(
      document.discount_kind,
      document.discount_value,
      document.discount_value,
    );
    if (wholeSaleValue !== null) {
      metadata.push({ label: "Whole sale", value: wholeSaleValue });
    }
  }

  const documentLines = discountLines
    .filter((line) => line.document_id === documentId)
    .sort((left, right) => {
      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
  for (const line of documentLines) {
    const title = scalarText(line.title);
    const value = discountMetadataValue(
      line.discount_kind,
      line.discount_pct,
      line.discount_amount,
    );
    if (title !== null && value !== null) {
      metadata.push({ label: title, value });
    }
  }
  if (metadata.length === 0) return null;

  return createTraceEvent(`discount:${documentId}`, canonical.received_at, {
    kind: "discount_applied",
    category: "payments",
    tone: "payment",
    title: "Discount applied",
    actorName: actorName(canonical.received_by, context),
    reference: scalarText(document?.number),
    metadata,
    href: documentHref(documentId),
  });
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
    if (left.at !== right.at) return left.at > right.at ? -1 : 1;
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
