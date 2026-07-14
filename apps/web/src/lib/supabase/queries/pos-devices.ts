import { createClient } from "@/lib/supabase/server";
import { rupeesToCents } from "@/lib/money";
import { muNow, muDateTime, muToday } from "@/lib/mu-date";
import { getSessionContext } from "@/lib/auth/session";
import { fetchAllRowsByKeyset } from "@/lib/supabase/paginate";
import {
  TRACE_SOURCE_LIMIT,
  compareTraceTimestamps,
  loadDeviceTraceability,
  mapAuditTraceEvent,
  mapPaymentTraceEvent,
  mapSessionCloseTraceEvent,
  mapSessionOpenTraceEvent,
  normalizeTraceRange,
  sortTraceEvents,
  type DeviceTraceabilityData,
  type TraceActorRow,
  type TraceAuditRow,
  type TraceDiscountLineRow,
  type TraceEvent as StructuredTraceEvent,
  type TraceMapperContext,
  type TracePaymentRow,
  type TraceRangeInput,
  type TraceRepository,
  type TraceSessionPaymentRow,
  type TraceSessionRow,
} from "@/features/pos/traceability";

// ─── Point of Sale module queries ────────────────────────────────────────────
// A "device" is a registered tablet (devices table, self-registered via the
// register_device RPC) plus the synthesized 'back-office' entry — the web app
// itself, which opens tills as device_id 'back-office' but never registers.
// Till state hangs off cash_sessions.device_id (free text = device_code).

const ONLINE_WINDOW_MS = 10 * 60_000; // heartbeat every ~4 min while foregrounded

export interface DeviceTill {
  sessionId: string;
  openedAt: string;
  openedByName: string | null;
  openingFloatCents: number;
  cashCollectedCents: number;
  cashOutCents: number; // net till movements (petty cash), ≤ 0
  expectedCents: number;
}

export interface PosDevice {
  id: string | null; // null for synthesized entries (back-office / unregistered)
  code: string;
  name: string;
  model: string | null;
  appVersion: string | null;
  isActive: boolean;
  isBackOffice: boolean;
  online: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  till: DeviceTill | null;
}

export interface RecentCashup {
  id: string;
  deviceCode: string;
  openedAt: string;
  closedAt: string | null;
  expectedCents: number;
  countedCents: number;
  varianceCents: number;
}

export interface PeriodStrip {
  lastClosed: string | null; // 'YYYY-MM'
  closable: string | null;   // the previous MU month, if it exists in data and isn't closed
}

export interface PosOverview {
  tradingName: string;
  deviceCount: number; // active registered tablets
  devices: PosDevice[];
  recent: RecentCashup[];
  periods: PeriodStrip;
}

/** Previous Mauritius calendar month as 'YYYY-MM' (the month that can be closed). */
function previousMuMonth(): string {
  const mu = muNow();
  const y = mu.getUTCFullYear();
  const m = mu.getUTCMonth(); // 0-based current month → previous month = m-1
  const prev = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getPosOverview(): Promise<PosOverview> {
  const sb = await createClient();
  const [bsRes, devRes, sessRes, usersRes, closesRes] = await Promise.all([
    sb.from("business_settings").select("trading_name").limit(1).maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb.from("devices" as any) as any).select("*").order("first_seen", { ascending: true }),
    sb.from("cash_sessions").select("*").order("opened_at", { ascending: false }).limit(40),
    sb.from("app_users").select("id, display_name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb.from("period_closes" as any) as any).select("period").order("period", { ascending: false }).limit(1),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRows = (devRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions = (sessRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameById = new Map(((usersRes.data ?? []) as any[]).map((u) => [u.id, u.display_name as string]));

  const openByDevice = new Map<string, DeviceTill>();
  const openIds: string[] = [];
  for (const s of sessions) {
    if (s.status !== "open") continue;
    openIds.push(s.id);
    openByDevice.set(s.device_id, {
      sessionId: s.id,
      openedAt: s.opened_at,
      openedByName: nameById.get(s.opened_by) ?? null,
      openingFloatCents: rupeesToCents(Number(s.opening_float)),
      cashCollectedCents: 0, // filled below
      cashOutCents: 0,
      expectedCents: rupeesToCents(Number(s.opening_float)),
    });
  }

  if (openIds.length > 0) {
    const [{ data: pays }, movesRes] = await Promise.all([
      sb.from("payments").select("cash_session_id, amount").in("cash_session_id", openIds).eq("method", "cash"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.from("till_movements" as any) as any).select("cash_session_id, amount").in("cash_session_id", openIds),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (pays ?? []) as any[]) {
      for (const till of openByDevice.values()) {
        if (till.sessionId === p.cash_session_id) till.cashCollectedCents += rupeesToCents(Number(p.amount));
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of ((movesRes.data ?? []) as any[])) {
      for (const till of openByDevice.values()) {
        if (till.sessionId === m.cash_session_id) till.cashOutCents += rupeesToCents(Number(m.amount));
      }
    }
    // Drawer truth: float + cash payments + petty movements (negative).
    for (const till of openByDevice.values()) {
      till.expectedCents = till.openingFloatCents + till.cashCollectedCents + till.cashOutCents;
    }
  }

  const now = Date.now();
  const devices: PosDevice[] = deviceRows.map((d) => ({
    id: d.id,
    code: d.device_code,
    name: d.display_name || d.device_code,
    model: d.model ?? null,
    appVersion: d.app_version ?? null,
    isActive: !!d.is_active,
    isBackOffice: false,
    online: now - Date.parse(d.last_seen) < ONLINE_WINDOW_MS,
    firstSeen: d.first_seen,
    lastSeen: d.last_seen,
    till: openByDevice.get(d.device_code) ?? null,
  }));

  // The web back office is always present, first in the list.
  devices.unshift({
    id: null,
    code: "back-office",
    name: "Back office (web)",
    model: null,
    appVersion: null,
    isActive: true,
    isBackOffice: true,
    online: true,
    firstSeen: null,
    lastSeen: null,
    till: openByDevice.get("back-office") ?? null,
  });

  // A till opened by a tablet that never registered (pre-registry APK) must
  // still be visible — synthesize an entry from its session.
  const known = new Set(devices.map((d) => d.code));
  for (const [code, till] of openByDevice) {
    if (!known.has(code)) {
      devices.push({
        id: null, code, name: code, model: null, appVersion: null,
        isActive: true, isBackOffice: false, online: false,
        firstSeen: null, lastSeen: null, till,
      });
    }
  }

  const recent: RecentCashup[] = sessions
    .filter((s) => s.status === "closed")
    .slice(0, 12)
    .map((s) => ({
      id: s.id,
      deviceCode: s.device_id,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      expectedCents: rupeesToCents(Number(s.expected_cash ?? 0)),
      countedCents: rupeesToCents(Number(s.closing_count ?? 0)),
      varianceCents: rupeesToCents(Number(s.variance ?? 0)),
    }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastClosed = ((closesRes.data ?? []) as any[])[0]?.period ?? null;
  const prev = previousMuMonth();
  const periods: PeriodStrip = {
    lastClosed,
    closable: lastClosed != null && lastClosed >= prev ? null : prev,
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tradingName: ((bsRes.data as any)?.trading_name as string) ?? "Carfectionist",
    deviceCount: deviceRows.filter((d) => d.is_active).length,
    devices,
    recent,
    periods,
  };
}

// ─── Per-device dashboard ────────────────────────────────────────────────────

interface TraceQueryError {
  message: string;
}

interface TraceQueryResult<T> {
  data: T[] | null;
  error: TraceQueryError | null;
}

export interface TraceQueryBuilder<T>
  extends PromiseLike<TraceQueryResult<T>> {
  select(columns: string): TraceQueryBuilder<T>;
  eq(column: string, value: unknown): TraceQueryBuilder<T>;
  gte(column: string, value: unknown): TraceQueryBuilder<T>;
  gt(column: string, value: unknown): TraceQueryBuilder<T>;
  lt(column: string, value: unknown): TraceQueryBuilder<T>;
  not(
    column: string,
    operator: string,
    value: unknown,
  ): TraceQueryBuilder<T>;
  in(column: string, values: readonly string[]): TraceQueryBuilder<T>;
  or(filters: string): TraceQueryBuilder<T>;
  order(
    column: string,
    options: { ascending: boolean },
  ): TraceQueryBuilder<T>;
  limit(count: number): TraceQueryBuilder<T>;
  range(from: number, to: number): PromiseLike<TraceQueryResult<T>>;
}

export interface TraceSupabaseClient {
  from(table: string): TraceQueryBuilder<unknown>;
}

const TRACE_AUDIT_COLUMNS =
  "id, event_type, payload, created_at, actor_id, ref_id";
const TRACE_SESSION_COLUMNS =
  "id, device_id, opened_at, opened_by, opening_float, closed_at, closed_by, expected_cash, closing_count, variance";
const TRACE_PAYMENT_COLUMNS =
  "id, cash_session_id, document_id, method, amount, received_at, received_by, reverses_payment_id, documents(id, number, discount_kind, discount_value), cash_sessions!inner(device_id)";
const TRACE_DISCOUNT_LINE_COLUMNS =
  "id, document_id, title, discount_pct, discount_kind, discount_amount";
const TRACE_CLOSING_PAYMENT_COLUMNS =
  "id, cash_session_id, method, amount";

function traceQuery<T>(
  client: TraceSupabaseClient,
  table: string,
): TraceQueryBuilder<T> {
  return client.from(table) as TraceQueryBuilder<T>;
}

async function readTraceRows<T>(
  query: PromiseLike<TraceQueryResult<T>>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error !== null) throw new Error(error.message);
  return data ?? [];
}

interface PaymentCursor {
  receivedAt: string;
  id: string;
}

function paymentCursor(row: TracePaymentRow): PaymentCursor {
  return { receivedAt: row.received_at, id: row.id };
}

function comparePaymentCursor(
  left: PaymentCursor,
  right: PaymentCursor,
): number {
  const receivedAtOrder = compareTraceTimestamps(
    left.receivedAt,
    right.receivedAt,
    "asc",
  );
  return receivedAtOrder || left.id.localeCompare(right.id);
}

function paymentCursorFilter(after: PaymentCursor): string {
  return [
    `received_at.gt.${after.receivedAt}`,
    `and(received_at.eq.${after.receivedAt},id.gt.${after.id})`,
  ].join(",");
}

export function createSupabaseTraceRepository(
  client: TraceSupabaseClient,
): TraceRepository {
  return {
    async fetchAuditCandidates(code, range) {
      const query = traceQuery<TraceAuditRow>(client, "audit_events")
        .select(TRACE_AUDIT_COLUMNS)
        .eq("device_id", code)
        .gte("created_at", range.startIso)
        .lt("created_at", range.endExclusiveIso)
        .not(
          "event_type",
          "in",
          "(payment_reversed,period_closed)",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(TRACE_SOURCE_LIMIT);
      return readTraceRows(query);
    },

    async fetchPaymentCandidates(code, range) {
      const query = traceQuery<TracePaymentRow>(client, "payments")
        .select(TRACE_PAYMENT_COLUMNS)
        .eq("cash_sessions.device_id", code)
        .gte("received_at", range.startIso)
        .lt("received_at", range.endExclusiveIso)
        .order("received_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(TRACE_SOURCE_LIMIT);
      return readTraceRows(query);
    },

    async fetchSessionOpenCandidates(code, range) {
      const query = traceQuery<TraceSessionRow>(client, "cash_sessions")
        .select(TRACE_SESSION_COLUMNS)
        .eq("device_id", code)
        .gte("opened_at", range.startIso)
        .lt("opened_at", range.endExclusiveIso)
        .order("opened_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(TRACE_SOURCE_LIMIT);
      return readTraceRows(query);
    },

    async fetchSessionCloseCandidates(code, range) {
      const query = traceQuery<TraceSessionRow>(client, "cash_sessions")
        .select(TRACE_SESSION_COLUMNS)
        .eq("device_id", code)
        .not("closed_at", "is", null)
        .gte("closed_at", range.startIso)
        .lt("closed_at", range.endExclusiveIso)
        .order("closed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(TRACE_SOURCE_LIMIT);
      return readTraceRows(query);
    },

    async fetchReversalAudits(originalIds) {
      if (originalIds.length === 0) return [];
      const query = traceQuery<TraceAuditRow>(client, "audit_events")
        .select(TRACE_AUDIT_COLUMNS)
        .eq("event_type", "payment_reversed")
        .in("ref_id", originalIds);
      return readTraceRows(query);
    },

    async fetchDiscountLines(documentIds) {
      if (documentIds.length === 0) return [];
      return fetchAllRowsByKeyset<TraceDiscountLineRow, string>(
        (after) => {
          let query = traceQuery<TraceDiscountLineRow>(
            client,
            "document_lines",
          )
            .select(TRACE_DISCOUNT_LINE_COLUMNS)
            .in("document_id", documentIds)
            .order("id", { ascending: true });
          if (after !== null) query = query.gt("id", after);
          return query;
        },
        (row) => row.id,
        (left, right) => left.localeCompare(right),
      );
    },

    async fetchCanonicalPayments(code, documentIds) {
      if (documentIds.length === 0) return [];
      return fetchAllRowsByKeyset<TracePaymentRow, PaymentCursor>(
        (after) => {
          let query = traceQuery<TracePaymentRow>(client, "payments")
            .select(TRACE_PAYMENT_COLUMNS)
            .eq("cash_sessions.device_id", code)
            .in("document_id", documentIds)
            .gt("amount", 0)
            .order("received_at", { ascending: true })
            .order("id", { ascending: true });
          if (after !== null) query = query.or(paymentCursorFilter(after));
          return query;
        },
        paymentCursor,
        comparePaymentCursor,
      );
    },

    async fetchActorNames(actorIds) {
      if (actorIds.length === 0) return [];
      const query = traceQuery<TraceActorRow>(client, "app_users")
        .select("id, display_name")
        .in("id", actorIds);
      return readTraceRows(query);
    },

    async fetchClosingSessionPayments(sessionIds) {
      if (sessionIds.length === 0) return [];
      return fetchAllRowsByKeyset<TraceSessionPaymentRow, string>(
        (after) => {
          let query = traceQuery<TraceSessionPaymentRow>(client, "payments")
            .select(TRACE_CLOSING_PAYMENT_COLUMNS)
            .in("cash_session_id", sessionIds)
            .order("id", { ascending: true });
          if (after !== null) query = query.gt("id", after);
          return query;
        },
        (row) => row.id,
        (left, right) => left.localeCompare(right),
      );
    },
  };
}

export async function getDeviceTraceability(
  code: string,
  input: TraceRangeInput = {},
): Promise<DeviceTraceabilityData> {
  const session = await getSessionContext();
  const range = normalizeTraceRange(input);
  if (session?.role !== "owner") {
    return {
      trace: [],
      traceState: {
        status: "unavailable",
        capped: false,
        range: { from: range.from, to: range.to },
      },
    };
  }

  const supabase = await createClient();
  const repository = createSupabaseTraceRepository(
    supabase as unknown as TraceSupabaseClient,
  );
  return loadDeviceTraceability(code, range, repository);
}

export interface SessionMovement {
  id: string;
  at: string; // MU "yyyy-mm-dd HH:MM"
  method: string;
  amountCents: number;
  number: string | null;
  docId: string | null; // → /sales/[id]
  byName: string | null;
  isReversal: boolean;   // this row IS the negative mirror
  wasReversed: boolean;  // this row was later undone — display muted, never hidden (ledger integrity)
}

export interface DeviceSession {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
  closedByName: string | null;
  openingFloatCents: number;
  expectedCents: number; // stored for closed; live for open
  countedCents: number | null;
  varianceCents: number | null;
  cashCents: number;       // cash payments in the session (live)
  cashOutCents: number;    // net petty-cash movements (≤ 0)
  nonCash: { method: string; cents: number }[]; // "to bank" at close, Cashmag-style
  movements: SessionMovement[];
}

export interface DeviceLastActivity {
  at: string;
  atLabel: string;
  title: string;
  summary: string | null;
}

/** A money movement leaving the till — Cashmag's "cash outflows". */
export interface OutflowRow {
  key: string;
  atIso: string;
  at: string; // MU display
  byName: string | null;
  method: string;
  amountCents: number; // negative
  type: string;    // "Bank deposit" | "Payment reversed" | "Petty cash"
  comment: string; // "Automatic bank deposit" | invoice number | reason
  docId: string | null; // → /sales/[id] for reversals
  /** True when this reversal's ORIGINAL is also in view — the pair cancels, so
   *  both rows render muted and neither counts in the period totals. A reversal
   *  of a prior-period payment stays live: money really left the till today. */
  cancelled: boolean;
}

/** The Cash Flow tab, driven entirely by date pickers (owner's Cashmag spec):
 *  History = the till closure(s) saved on the reference date; Cash movements =
 *  inflows/outflows over a from–to period. */
export interface CashflowData {
  refDate: string; // yyyy-mm-dd (MU)
  closures: DeviceSession[];
  from: string;
  to: string;
  inflows: SessionMovement[];
  outflows: OutflowRow[];
}

export interface DeviceDashboard {
  device: PosDevice;
  sessions: DeviceSession[]; // newest first, incl. open (General tab)
  lastActivity: DeviceLastActivity | null;
  todayCents: { method: string; cents: number }[]; // takings today (MU) by method
  cashflow: CashflowData;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** MU calendar day → [start, end) as epoch ms (Mauritius is UTC+04, no DST). */
const muDayStart = (d: string) => Date.parse(`${d}T00:00:00+04:00`);
const muDayEnd = (d: string) => muDayStart(d) + 24 * 3600_000;

function deviceActivitySummary(event: StructuredTraceEvent): string | null {
  const parts: string[] = [];
  if (event.summary !== null) parts.push(event.summary);
  if (event.actorName !== null) parts.push(event.actorName);
  if (event.amountCents !== null) {
    parts.push(
      `Rs ${(event.amountCents / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    );
  }
  if (event.method !== null) parts.push(event.method);
  if (event.reference !== null) parts.push(event.reference);
  if (event.reason !== null) parts.push(event.reason);
  for (const item of event.metadata) {
    parts.push(`${item.label}: ${item.value}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

function toDeviceLastActivity(
  event: StructuredTraceEvent | undefined,
): DeviceLastActivity | null {
  return event === undefined
    ? null
    : {
        at: event.at,
        atLabel: event.atLabel,
        title: event.title,
        summary: deviceActivitySummary(event),
      };
}

export async function getDeviceDashboard(
  code: string,
  opts?: { ref?: string; from?: string; to?: string },
): Promise<DeviceDashboard | null> {
  const sb = await createClient();
  const overview = await getPosOverview();
  const device = overview.devices.find((d) => d.code === code);
  if (!device) return null;

  // Cash Flow is driven entirely by date pickers (owner's Cashmag spec):
  // reference date for the closure history, from–to period for movements.
  const today = muToday();
  const refDate = opts?.ref && DATE_RE.test(opts.ref) ? opts.ref : today;
  let from = opts?.from && DATE_RE.test(opts.from) ? opts.from : (opts?.to && DATE_RE.test(opts.to) ? opts.to : today);
  let to = opts?.to && DATE_RE.test(opts.to) ? opts.to : from;
  if (to < from) [from, to] = [to, from];

  // General needs only the newest lifetime device event. The owner-only,
  // range-bounded trace ledger is loaded separately by getDeviceTraceability.
  const latestAuditQ = sb
    .from("audit_events")
    .select("id, event_type, payload, created_at, actor_id, ref_id")
    .eq("device_id", code)
    .not("event_type", "in", "(payment_reversed,period_closed)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  const [sessRes, usersRes, latestAuditRes] = await Promise.all([
    // ALL of this device's sessions (≈1/day) — the pickers can reach any date.
    sb.from("cash_sessions").select("*").eq("device_id", code).order("opened_at", { ascending: false }).limit(400),
    sb.from("app_users").select("id, display_name"),
    latestAuditQ,
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSessions = (sessRes.data ?? []) as any[];
  const sessions = allSessions.slice(0, 20); // General tab window
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameById = new Map(((usersRes.data ?? []) as any[]).map((u) => [u.id, u.display_name as string]));

  const fromMs = muDayStart(from);
  const endMs = muDayEnd(to);
  const refMs = muDayStart(refDate);
  const refEndMs = muDayEnd(refDate);
  // Sessions that could hold payments inside the period (opened before its end,
  // not closed before its start), plus the reference date's closures.
  const rangeSessions = allSessions.filter(
    (s) => Date.parse(s.opened_at) < endMs && (!s.closed_at || Date.parse(s.closed_at) >= fromMs),
  );
  const closureSessions = allSessions.filter(
    (s) => s.closed_at && Date.parse(s.closed_at) >= refMs && Date.parse(s.closed_at) < refEndMs,
  );

  const PAY_COLS = "id, cash_session_id, document_id, method, amount, received_at, received_by, reverses_payment_id, documents(id, number, discount_kind, discount_value)";
  const fetchPays = async (ids: string[]) => {
    if (ids.length === 0) return [];
    const { data } = await sb.from("payments").select(PAY_COLS).in("cash_session_id", ids).order("received_at", { ascending: false }).limit(600);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[];
  };
  // One fetch per distinct window: recent (General) and the
  // union of period + reference sessions (Cash Flow). Deposits need a closed
  // session's FULL payment set, so the Cash Flow fetch is not date-filtered.
  const flowIds = [...new Set([...rangeSessions, ...closureSessions].map((s) => s.id))];
  const allWindowIds = [...new Set([...sessions.map((s) => s.id), ...flowIds])];
  const [payRows, flowPays, movesRes] = await Promise.all([
    fetchPays(sessions.map((s) => s.id)),
    fetchPays(flowIds),
    // Petty-cash movements for every session in view (tiny table).
    allWindowIds.length === 0
      ? Promise.resolve({ data: [] })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (sb.from("till_movements" as any) as any)
          .select("id, cash_session_id, amount, reason, created_by, created_at")
          .in("cash_session_id", allWindowIds)
          .order("created_at", { ascending: false }),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moveRows = ((movesRes as any).data ?? []) as any[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupBySession = (rows: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = new Map<string, any[]>();
    for (const p of rows) {
      const arr = m.get(p.cash_session_id) ?? [];
      arr.push(p);
      m.set(p.cash_session_id, arr);
    }
    return m;
  };
  const paysBySession = groupBySession(payRows);
  const flowBySession = groupBySession(flowPays);
  const movesBySession = groupBySession(moveRows);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildSession = (s: any, pays: any[]): DeviceSession => {
    let cash = 0;
    const nonCashMap = new Map<string, number>();
    const undone = new Set(pays.map((p) => p.reverses_payment_id).filter(Boolean));
    const movements: SessionMovement[] = pays.map((p) => {
      const cents = rupeesToCents(Number(p.amount));
      if (p.method === "cash") cash += cents;
      else nonCashMap.set(p.method, (nonCashMap.get(p.method) ?? 0) + cents);
      return {
        id: p.id,
        at: muDateTime(p.received_at),
        method: p.method,
        amountCents: cents,
        number: p.documents?.number ?? null,
        docId: p.documents?.id ?? null,
        byName: nameById.get(p.received_by) ?? null,
        isReversal: p.reverses_payment_id != null,
        wasReversed: undone.has(p.id),
      };
    });
    const cashOut = (movesBySession.get(s.id) ?? []).reduce((t, m) => t + rupeesToCents(Number(m.amount)), 0);
    const floatCents = rupeesToCents(Number(s.opening_float));
    const isOpen = s.status === "open";
    return {
      id: s.id,
      status: s.status,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      openedByName: nameById.get(s.opened_by) ?? null,
      closedByName: nameById.get(s.closed_by) ?? null,
      openingFloatCents: floatCents,
      // Drawer truth: float + cash payments + petty movements (negative).
      expectedCents: isOpen ? floatCents + cash + cashOut : rupeesToCents(Number(s.expected_cash ?? 0)),
      countedCents: isOpen ? null : rupeesToCents(Number(s.closing_count ?? 0)),
      varianceCents: isOpen ? null : rupeesToCents(Number(s.variance ?? 0)),
      cashCents: cash,
      cashOutCents: cashOut,
      // Net ≤ 0 methods (e.g. a fully-reversed Juice pair) carry no money to the
      // bank — "Juice Rs 0.00 straight to the bank" is noise, not information.
      nonCash: [...nonCashMap.entries()].filter(([, cents]) => cents > 0).map(([method, cents]) => ({ method, cents })),
      movements,
    };
  };

  const deviceSessions: DeviceSession[] = sessions.map((s) => buildSession(s, paysBySession.get(s.id) ?? []));

  // ── Cash Flow (date-driven) ────────────────────────────────────────────────
  const closures: DeviceSession[] = closureSessions.map((s) => buildSession(s, flowBySession.get(s.id) ?? []));

  const inRange = (iso: string) => {
    const t = Date.parse(iso);
    return t >= fromMs && t < endMs;
  };
  // A ledger never hides a movement — a mistake and its reversal BOTH stay (the
  // totals reconcile because of them). The original is flagged so the pair reads
  // as a correction, and the reversal row carries the operator's required reason.
  const undoneInFlow = new Set(flowPays.map((p) => p.reverses_payment_id).filter(Boolean));
  const reasonByOriginal = new Map<string, string>();
  if (undoneInFlow.size > 0) {
    const { data: revAudits } = await sb
      .from("audit_events")
      .select("ref_id, payload")
      .eq("event_type", "payment_reversed")
      .in("ref_id", [...undoneInFlow] as string[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of (revAudits ?? []) as any[]) {
      if (a.ref_id && a.payload?.reason) reasonByOriginal.set(a.ref_id, a.payload.reason);
    }
  }

  const inflows: SessionMovement[] = flowPays
    .filter((p) => Number(p.amount) > 0 && inRange(p.received_at))
    .map((p) => ({
      id: p.id,
      at: muDateTime(p.received_at),
      method: p.method,
      amountCents: rupeesToCents(Number(p.amount)),
      number: p.documents?.number ?? null,
      docId: p.documents?.id ?? null,
      byName: nameById.get(p.received_by) ?? null,
      isReversal: false,
      wasReversed: undoneInFlow.has(p.id),
    }));

  // Originals that are BOTH undone and visible as inflows of this period — only
  // those pairs cancel out of the totals.
  const originalsInView = new Set(
    flowPays.filter((p) => Number(p.amount) > 0 && inRange(p.received_at) && undoneInFlow.has(p.id)).map((p) => p.id),
  );

  const outflows: OutflowRow[] = flowPays
    .filter((p) => Number(p.amount) < 0 && inRange(p.received_at))
    .map((p) => ({
      key: `r${p.id}`,
      atIso: p.received_at,
      at: muDateTime(p.received_at),
      byName: nameById.get(p.received_by) ?? null,
      method: p.method,
      amountCents: rupeesToCents(Number(p.amount)),
      type: "Payment reversed",
      comment: [p.documents?.number, p.reverses_payment_id && reasonByOriginal.get(p.reverses_payment_id) ? `“${reasonByOriginal.get(p.reverses_payment_id)}”` : null]
        .filter(Boolean)
        .join(" · "),
      docId: p.documents?.id ?? null,
      cancelled: p.reverses_payment_id != null && originalsInView.has(p.reverses_payment_id),
    }));
  // Manual petty-cash outs (Cashmag's type "Autre" rows, made at the till).
  const flowIdSet = new Set(flowIds);
  for (const m of moveRows) {
    if (!flowIdSet.has(m.cash_session_id)) continue;
    if (!inRange(m.created_at) || Number(m.amount) >= 0) continue;
    outflows.push({
      key: `m${m.id}`,
      atIso: m.created_at,
      at: muDateTime(m.created_at),
      byName: nameById.get(m.created_by) ?? null,
      method: "cash",
      amountCents: rupeesToCents(Number(m.amount)),
      type: "Petty cash",
      comment: m.reason ?? "",
      docId: null,
      cancelled: false,
    });
  }
  // Cashmag books each closure's non-cash takings out of the register as
  // automatic bank deposits — synthesize the same rows at closing time.
  for (const s of rangeSessions) {
    if (!s.closed_at || !inRange(s.closed_at)) continue;
    const net = new Map<string, number>();
    for (const p of flowBySession.get(s.id) ?? []) {
      if (p.method === "cash") continue;
      net.set(p.method, (net.get(p.method) ?? 0) + rupeesToCents(Number(p.amount)));
    }
    for (const [method, cents] of net) {
      if (cents <= 0) continue;
      outflows.push({
        key: `d${s.id}:${method}`,
        atIso: s.closed_at,
        at: muDateTime(s.closed_at),
        byName: nameById.get(s.closed_by) ?? null,
        method,
        amountCents: -cents,
        type: "Bank deposit",
        comment: "Automatic bank deposit",
        docId: null,
        cancelled: false,
      });
    }
  }
  outflows.sort((a, b) => (a.atIso < b.atIso ? 1 : -1));

  const cashflow: CashflowData = { refDate, closures, from, to, inflows, outflows };

  // Cheap General-tab activity: combine one newest lifetime audit with the
  // recent session/payment rows already loaded for the dashboard.
  const activityEvents: StructuredTraceEvent[] = [];
  const activityDocumentIds = new Map<string, string>();
  for (const payment of payRows as TracePaymentRow[]) {
    const document = payment.documents;
    if (document?.number && document.id === payment.document_id) {
      activityDocumentIds.set(document.number, document.id);
    }
  }
  const activityContext: TraceMapperContext = {
    actorNames: nameById,
    documentIdsByNumber: activityDocumentIds,
    reversalAudits: [],
    sessionPayments: [],
  };

  const latestAudit = (latestAuditRes.data?.[0] ?? null) as
    | TraceAuditRow
    | null;
  if (latestAudit !== null) {
    const event = mapAuditTraceEvent(latestAudit, activityContext);
    if (event !== null) activityEvents.push(event);
  }

  for (const session of sessions as TraceSessionRow[]) {
    activityEvents.push(mapSessionOpenTraceEvent(session, activityContext));
    const closeEvent = mapSessionCloseTraceEvent(session, activityContext);
    if (closeEvent !== null) activityEvents.push(closeEvent);
  }
  for (const payment of payRows as TracePaymentRow[]) {
    activityEvents.push(mapPaymentTraceEvent(payment, activityContext));
  }

  const lastActivity = toDeviceLastActivity(sortTraceEvents(activityEvents)[0]);

  // Today's takings by method (MU day) across this device's sessions.
  const muMidnight = new Date(muNow().toISOString().slice(0, 10) + "T00:00:00+04:00").getTime();
  const todayMap = new Map<string, number>();
  for (const p of payRows) {
    if (Date.parse(p.received_at) >= muMidnight) {
      todayMap.set(p.method, (todayMap.get(p.method) ?? 0) + rupeesToCents(Number(p.amount)));
    }
  }

  return {
    device,
    sessions: deviceSessions,
    lastActivity,
    todayCents: [...todayMap.entries()].map(([method, cents]) => ({ method, cents })),
    cashflow,
  };
}
