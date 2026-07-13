import { MU_OFFSET_MS } from '@/lib/mu-date';
import { rupeesToCents } from '@/lib/money';

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 93;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type SalesRangeKey = 'today' | 'last7' | 'month' | 'custom';
export type SalesBucketKind = 'hour' | 'day';

export interface SalesPeriodInput {
  salesRange?: string;
  salesFrom?: string;
  salesTo?: string;
}

export type SalesSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function normalizeSalesPeriodInput(
  input: SalesSearchParams,
): SalesPeriodInput {
  const scalar = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : undefined;

  return {
    salesRange: scalar(input.salesRange),
    salesFrom: scalar(input.salesFrom),
    salesTo: scalar(input.salesTo),
  };
}

export interface SalesPeriod {
  range: SalesRangeKey;
  bucket: SalesBucketKind;
  from: string;
  to: string;
  startIso: string;
  endExclusiveIso: string;
  label: string;
}

export interface SalesQuerySpec {
  columns: 'id, doc_type, status, total_incl, origin, issued_at';
  docTypes: ['invoice', 'credit_note'];
  statuses: ['issued', 'partly_paid', 'paid'];
  startIso: string;
  endExclusiveIso: string;
}

export interface SalesDocumentRow {
  id: string;
  doc_type: 'invoice' | 'credit_note';
  status: 'draft' | 'issued' | 'partly_paid' | 'paid' | 'void';
  total_incl: number | string;
  origin: 'standalone' | 'from_job';
  issued_at: string | null;
}

export interface SalesPoint {
  key: string;
  axisLabel: string;
  fullLabel: string;
  counterCents: number;
  workshopCents: number;
  totalCents: number;
}

export interface ReadySalesPerformance {
  status: 'ready';
  period: SalesPeriod;
  points: SalesPoint[];
  totalCents: number;
  hasSales: boolean;
}

export interface UnavailableSalesPerformance {
  status: 'unavailable';
  period: SalesPeriod;
  points: [];
  totalCents: null;
  hasSales: false;
}

export type SalesPerformanceData =
  | ReadySalesPerformance
  | UnavailableSalesPerformance;

function dateMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function addDays(date: string, amount: number): string {
  return new Date(dateMs(date) + amount * DAY_MS).toISOString().slice(0, 10);
}

function daysInclusive(from: string, to: string): number {
  return Math.floor((dateMs(to) - dateMs(from)) / DAY_MS) + 1;
}

function isDate(value: string | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

function boundaryIso(date: string): string {
  return new Date(`${date}T00:00:00+04:00`).toISOString();
}

function dateParts(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  return {
    day: value.getUTCDate(),
    month: value.getUTCMonth(),
    year: value.getUTCFullYear(),
    weekday: value.getUTCDay(),
  };
}

function periodLabel(from: string, to: string): string {
  const start = dateParts(from);
  const end = dateParts(to);
  if (from === to) return `${start.day} ${MONTHS[start.month]} ${start.year}`;
  if (start.month === end.month && start.year === end.year) {
    return `${start.day}\u2013${end.day} ${MONTHS[start.month]} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${MONTHS[start.month]}\u2013${end.day} ${MONTHS[end.month]} ${start.year}`;
  }
  return `${start.day} ${MONTHS[start.month]} ${start.year}\u2013${end.day} ${MONTHS[end.month]} ${end.year}`;
}

function makePeriod(
  range: SalesRangeKey,
  bucket: SalesBucketKind,
  from: string,
  to: string,
): SalesPeriod {
  return {
    range,
    bucket,
    from,
    to,
    startIso: boundaryIso(from),
    endExclusiveIso: boundaryIso(addDays(to, 1)),
    label: periodLabel(from, to),
  };
}

export function resolveSalesPeriod(
  input: SalesPeriodInput = {},
  nowMs = Date.now(),
): SalesPeriod {
  const today = new Date(nowMs + MU_OFFSET_MS).toISOString().slice(0, 10);
  if (input.salesRange === 'today') {
    return makePeriod('today', 'hour', today, today);
  }
  if (input.salesRange === 'last7') {
    return makePeriod('last7', 'day', addDays(today, -6), today);
  }
  if (
    input.salesRange === 'custom' &&
    isDate(input.salesFrom) &&
    isDate(input.salesTo)
  ) {
    const count = daysInclusive(input.salesFrom, input.salesTo);
    if (count >= 1 && count <= MAX_CUSTOM_DAYS) {
      return makePeriod('custom', 'day', input.salesFrom, input.salesTo);
    }
  }
  return makePeriod('month', 'day', `${today.slice(0, 7)}-01`, today);
}

export function salesQuerySpec(period: SalesPeriod): SalesQuerySpec {
  return {
    columns: 'id, doc_type, status, total_incl, origin, issued_at',
    docTypes: ['invoice', 'credit_note'],
    statuses: ['issued', 'partly_paid', 'paid'],
    startIso: period.startIso,
    endExclusiveIso: period.endExclusiveIso,
  };
}

function fullDayLabel(date: string): string {
  const value = dateParts(date);
  return `${WEEKDAYS[value.weekday]} ${value.day} ${MONTHS[value.month]} ${value.year}`;
}

function liveCents(row: SalesDocumentRow): number | null {
  const liveInvoice =
    row.doc_type === 'invoice' &&
    ['issued', 'partly_paid', 'paid'].includes(row.status);
  const liveCredit =
    row.doc_type === 'credit_note' && row.status === 'issued';
  if ((!liveInvoice && !liveCredit) || !row.issued_at) return null;

  const amount = Number(row.total_incl);
  if (!Number.isFinite(amount)) return null;

  const cents = rupeesToCents(amount);
  return liveCredit ? -cents : cents;
}

function emptyPoints(period: SalesPeriod): SalesPoint[] {
  if (period.bucket === 'hour') {
    return Array.from({ length: 24 }, (_, hour) => {
      const hh = String(hour).padStart(2, '0');
      return {
        key: `${period.from}T${hh}`,
        axisLabel: `${hh}:00`,
        fullLabel: `${fullDayLabel(period.from)}, ${hh}:00`,
        counterCents: 0,
        workshopCents: 0,
        totalCents: 0,
      };
    });
  }

  return Array.from(
    { length: daysInclusive(period.from, period.to) },
    (_, index) => {
      const date = addDays(period.from, index);
      const parts = dateParts(date);
      return {
        key: date,
        axisLabel: `${WEEKDAYS[parts.weekday].slice(0, 3)} ${String(parts.day).padStart(2, '0')}`,
        fullLabel: fullDayLabel(date),
        counterCents: 0,
        workshopCents: 0,
        totalCents: 0,
      };
    },
  );
}

export function buildSalesPerformance(
  period: SalesPeriod,
  rows: SalesDocumentRow[],
): ReadySalesPerformance {
  const points = emptyPoints(period);
  const byKey = new Map(points.map((point) => [point.key, point]));
  let hasSales = false;

  for (const row of rows) {
    const cents = liveCents(row);
    if (cents === null || !row.issued_at) continue;

    const local = new Date(
      Date.parse(row.issued_at) + MU_OFFSET_MS,
    ).toISOString();
    const key =
      period.bucket === 'hour' ? local.slice(0, 13) : local.slice(0, 10);
    const point = byKey.get(key);
    if (!point) continue;

    hasSales = true;
    if (row.origin === 'from_job') point.workshopCents += cents;
    else point.counterCents += cents;
    point.totalCents = point.counterCents + point.workshopCents;
  }

  return {
    status: 'ready',
    period,
    points,
    totalCents: points.reduce((sum, point) => sum + point.totalCents, 0),
    hasSales,
  };
}

export function unavailableSalesPerformance(
  period: SalesPeriod,
): UnavailableSalesPerformance {
  return {
    status: 'unavailable',
    period,
    points: [],
    totalCents: null,
    hasSales: false,
  };
}

export async function settleSalesPerformance(
  period: SalesPeriod,
  rowsPromise: Promise<SalesDocumentRow[]>,
): Promise<SalesPerformanceData> {
  try {
    return buildSalesPerformance(period, await rowsPromise);
  } catch {
    return unavailableSalesPerformance(period);
  }
}

export function formatCompactMUR(cents: number): string {
  const rupees = Math.trunc(cents) / 100;
  const abs = Math.abs(rupees);
  const compact = (divisor: number, suffix: string) =>
    `${Number((rupees / divisor).toFixed(2))}${suffix}`;

  if (abs >= 1_000_000) return `Rs ${compact(1_000_000, 'm')}`;
  if (abs >= 1_000) return `Rs ${compact(1_000, 'k')}`;
  return `Rs ${Math.trunc(rupees)}`;
}
