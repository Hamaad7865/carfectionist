import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const dependencyMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSessionContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: dependencyMocks.createClient,
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionContext: dependencyMocks.getSessionContext,
}));

import {
  loadDeviceTraceability,
  normalizeTraceRange,
  type NormalizedTraceRange,
  type TraceActorRow,
  type TraceAuditRow,
  type TraceDiscountLineRow,
  type TracePaymentRow,
  type TraceRepository,
  type TraceSessionPaymentRow,
  type TraceSessionRow,
} from "@/features/pos/traceability";
import {
  createSupabaseTraceRepository,
  getDeviceDashboard,
  getDeviceTraceability,
} from "./pos-devices";

const NOW = Date.parse("2026-07-14T08:00:00.000Z");
const RANGE = normalizeTraceRange(
  { from: "2026-07-14", to: "2026-07-14" },
  NOW,
);
const OLD_RANGE = normalizeTraceRange(
  { from: "2024-01-02", to: "2024-01-03" },
  NOW,
);

interface FakeTraceRepository extends TraceRepository {
  fetchAuditCandidates: Mock<TraceRepository["fetchAuditCandidates"]>;
  fetchPaymentCandidates: Mock<TraceRepository["fetchPaymentCandidates"]>;
  fetchSessionOpenCandidates: Mock<
    TraceRepository["fetchSessionOpenCandidates"]
  >;
  fetchSessionCloseCandidates: Mock<
    TraceRepository["fetchSessionCloseCandidates"]
  >;
  fetchReversalAudits: Mock<TraceRepository["fetchReversalAudits"]>;
  fetchDiscountLines: Mock<TraceRepository["fetchDiscountLines"]>;
  fetchCanonicalPayments: Mock<TraceRepository["fetchCanonicalPayments"]>;
  fetchActorNames: Mock<TraceRepository["fetchActorNames"]>;
  fetchClosingSessionPayments: Mock<
    TraceRepository["fetchClosingSessionPayments"]
  >;
}

function makeRepository(): FakeTraceRepository {
  return {
    fetchAuditCandidates: vi.fn(async () => []),
    fetchPaymentCandidates: vi.fn(async () => []),
    fetchSessionOpenCandidates: vi.fn(async () => []),
    fetchSessionCloseCandidates: vi.fn(async () => []),
    fetchReversalAudits: vi.fn(async () => []),
    fetchDiscountLines: vi.fn(async () => []),
    fetchCanonicalPayments: vi.fn(async () => []),
    fetchActorNames: vi.fn(async () => []),
    fetchClosingSessionPayments: vi.fn(async () => []),
  };
}

function makeAuditRow(
  id: string,
  overrides: Partial<TraceAuditRow> = {},
): TraceAuditRow {
  return {
    id,
    event_type: "signed_in",
    payload: {},
    created_at: "2026-07-14T08:00:00.000Z",
    actor_id: null,
    ref_id: null,
    ...overrides,
  };
}

function makePaymentRow(
  id: string,
  overrides: Partial<TracePaymentRow> = {},
): TracePaymentRow {
  return {
    id,
    cash_session_id: "session-1",
    document_id: "document-1",
    method: "cash",
    amount: "25.00",
    received_at: "2026-07-14T08:00:00.000Z",
    received_by: null,
    reverses_payment_id: null,
    documents: {
      id: "document-1",
      number: "INV-001",
      discount_kind: null,
      discount_value: null,
    },
    ...overrides,
  };
}

function makeSessionRow(
  id: string,
  overrides: Partial<TraceSessionRow> = {},
): TraceSessionRow {
  return {
    id,
    device_id: "pos-1",
    opened_at: "2026-07-14T06:00:00.000Z",
    opened_by: null,
    opening_float: "1000.00",
    closed_at: "2026-07-14T10:00:00.000Z",
    closed_by: null,
    expected_cash: "1200.00",
    closing_count: "1200.00",
    variance: "0",
    ...overrides,
  };
}

function makeDiscountLine(
  id: string,
  overrides: Partial<TraceDiscountLineRow> = {},
): TraceDiscountLineRow {
  return {
    id,
    document_id: "document-1",
    title: "Brake pads",
    discount_pct: "5",
    discount_kind: "percent",
    discount_amount: null,
    ...overrides,
  };
}

function expectUnavailable(
  result: Awaited<ReturnType<typeof loadDeviceTraceability>>,
  range: NormalizedTraceRange = RANGE,
) {
  expect(result).toEqual({
    trace: [],
    traceState: {
      status: "unavailable",
      capped: false,
      range: { from: range.from, to: range.to },
    },
  });
}

describe("loadDeviceTraceability", () => {
  it("starts all four range-bounded primary streams concurrently", async () => {
    const repository = makeRepository();
    const started = new Set<string>();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    repository.fetchAuditCandidates.mockImplementation(async () => {
      started.add("audit");
      await gate;
      return [];
    });
    repository.fetchPaymentCandidates.mockImplementation(async () => {
      started.add("payments");
      await gate;
      return [];
    });
    repository.fetchSessionOpenCandidates.mockImplementation(async () => {
      started.add("opens");
      await gate;
      return [];
    });
    repository.fetchSessionCloseCandidates.mockImplementation(async () => {
      started.add("closes");
      await gate;
      return [];
    });

    const pending = loadDeviceTraceability("pos-1", RANGE, repository);
    await vi.waitFor(() => expect(started.size).toBe(4));
    release();

    await expect(pending).resolves.toMatchObject({
      trace: [],
      traceState: { status: "ready", capped: false },
    });
    expect(repository.fetchAuditCandidates).toHaveBeenCalledWith(
      "pos-1",
      RANGE,
    );
    expect(repository.fetchPaymentCandidates).toHaveBeenCalledWith(
      "pos-1",
      RANGE,
    );
    expect(repository.fetchSessionOpenCandidates).toHaveBeenCalledWith(
      "pos-1",
      RANGE,
    );
    expect(repository.fetchSessionCloseCandidates).toHaveBeenCalledWith(
      "pos-1",
      RANGE,
    );
  });

  const primaryFailureCases: Array<{
    name: string;
    fail: (repository: FakeTraceRepository) => void;
  }> = [
    {
      name: "audit candidates",
      fail: (repository) =>
        repository.fetchAuditCandidates.mockRejectedValue(
          new Error("audit failed"),
        ),
    },
    {
      name: "payment candidates",
      fail: (repository) =>
        repository.fetchPaymentCandidates.mockRejectedValue(
          new Error("payments failed"),
        ),
    },
    {
      name: "session-open candidates",
      fail: (repository) =>
        repository.fetchSessionOpenCandidates.mockRejectedValue(
          new Error("opens failed"),
        ),
    },
    {
      name: "session-close candidates",
      fail: (repository) =>
        repository.fetchSessionCloseCandidates.mockRejectedValue(
          new Error("closes failed"),
        ),
    },
  ];

  it.each(primaryFailureCases)(
    "returns unavailable when mandatory $name fail",
    async ({ fail }) => {
      const repository = makeRepository();
      fail(repository);

      expectUnavailable(
        await loadDeviceTraceability("pos-1", RANGE, repository),
      );
      expect(repository.fetchReversalAudits).not.toHaveBeenCalled();
      expect(repository.fetchDiscountLines).not.toHaveBeenCalled();
      expect(repository.fetchActorNames).not.toHaveBeenCalled();
      expect(repository.fetchClosingSessionPayments).not.toHaveBeenCalled();
    },
  );

  it("never activates conditional sources for empty trigger sets", async () => {
    const repository = makeRepository();

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(result.traceState.status).toBe("ready");
    expect(repository.fetchReversalAudits).not.toHaveBeenCalled();
    expect(repository.fetchDiscountLines).not.toHaveBeenCalled();
    expect(repository.fetchCanonicalPayments).not.toHaveBeenCalled();
    expect(repository.fetchActorNames).not.toHaveBeenCalled();
    expect(repository.fetchClosingSessionPayments).not.toHaveBeenCalled();
  });

  const conditionalFailureCases: Array<{
    name: string;
    activate: (repository: FakeTraceRepository) => void;
    fail: (repository: FakeTraceRepository) => void;
  }> = [
    {
      name: "reversal audits",
      activate: (repository) => {
        repository.fetchPaymentCandidates.mockResolvedValue([
          makePaymentRow("reversal", {
            amount: "-25.00",
            reverses_payment_id: "original-payment",
          }),
        ]);
      },
      fail: (repository) =>
        repository.fetchReversalAudits.mockRejectedValue(
          new Error("reversal audit failed"),
        ),
    },
    {
      name: "document discount lines",
      activate: (repository) => {
        repository.fetchPaymentCandidates.mockResolvedValue([
          makePaymentRow("payment"),
        ]);
      },
      fail: (repository) =>
        repository.fetchDiscountLines.mockRejectedValue(
          new Error("discount lines failed"),
        ),
    },
    {
      name: "canonical discount payments",
      activate: (repository) => {
        repository.fetchPaymentCandidates.mockResolvedValue([
          makePaymentRow("payment", {
            documents: {
              id: "document-1",
              number: "INV-001",
              discount_kind: "percent",
              discount_value: "10",
            },
          }),
        ]);
      },
      fail: (repository) =>
        repository.fetchCanonicalPayments.mockRejectedValue(
          new Error("canonical payments failed"),
        ),
    },
    {
      name: "actor names",
      activate: (repository) => {
        repository.fetchAuditCandidates.mockResolvedValue([
          makeAuditRow("audit", { actor_id: "actor-1" }),
        ]);
      },
      fail: (repository) =>
        repository.fetchActorNames.mockRejectedValue(
          new Error("actor names failed"),
        ),
    },
    {
      name: "retained closing-session payments",
      activate: (repository) => {
        repository.fetchSessionCloseCandidates.mockResolvedValue([
          makeSessionRow("session-1"),
        ]);
      },
      fail: (repository) =>
        repository.fetchClosingSessionPayments.mockRejectedValue(
          new Error("closing payments failed"),
        ),
    },
  ];

  it.each(conditionalFailureCases)(
    "returns unavailable when activated $name fail",
    async ({ activate, fail }) => {
      const repository = makeRepository();
      activate(repository);
      fail(repository);

      expectUnavailable(
        await loadDeviceTraceability("pos-1", RANGE, repository),
      );
    },
  );

  it("resolves 101 exact actor IDs in complete chunks of at most 100", async () => {
    const repository = makeRepository();
    const audits = Array.from({ length: 101 }, (_, index) => {
      const actorId = `actor-${String(index).padStart(3, "0")}`;
      return makeAuditRow(`audit-${index}`, {
        actor_id: actorId,
        created_at: new Date(NOW - index * 1_000).toISOString(),
      });
    });
    repository.fetchAuditCandidates.mockResolvedValue(audits);
    repository.fetchActorNames.mockImplementation(async (actorIds) =>
      actorIds.map(
        (id): TraceActorRow => ({ id, display_name: `Name ${id}` }),
      ),
    );

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(result.traceState.status).toBe("ready");
    expect(repository.fetchActorNames).toHaveBeenCalledTimes(2);
    expect(repository.fetchActorNames.mock.calls.map(([ids]) => ids.length)).toEqual([
      100,
      1,
    ]);
    expect(
      new Set(repository.fetchActorNames.mock.calls.flatMap(([ids]) => ids)),
    ).toEqual(new Set(audits.map((audit) => audit.actor_id)));
    expect(result.trace).toHaveLength(101);
    expect(result.trace.every((event) => event.actorName !== null)).toBe(true);
  });

  it("renders a requested actor as unknown when the completed lookup omits its row", async () => {
    const repository = makeRepository();
    repository.fetchAuditCandidates.mockResolvedValue([
      makeAuditRow("missing-actor", { actor_id: "deleted-actor" }),
    ]);

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(repository.fetchActorNames).toHaveBeenCalledWith(["deleted-actor"]);
    expect(result.traceState.status).toBe("ready");
    expect(result.trace).toEqual([
      expect.objectContaining({
        key: "audit:missing-actor",
        actorName: "Unknown actor",
      }),
    ]);
  });

  it("keeps a missing reversal match ready with an explicit fallback reason", async () => {
    const repository = makeRepository();
    repository.fetchPaymentCandidates.mockResolvedValue([
      makePaymentRow("reversal", {
        amount: "-25.00",
        reverses_payment_id: "missing-original",
      }),
    ]);

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(result.traceState.status).toBe("ready");
    expect(repository.fetchReversalAudits).toHaveBeenCalledWith([
      "missing-original",
    ]);
    expect(result.trace).toEqual([
      expect.objectContaining({
        key: "payment:reversal",
        status: "reversed",
        reason: "Reason unavailable",
      }),
    ]);
  });

  it("emits one discount per document from the in-range canonical payment", async () => {
    const repository = makeRepository();
    repository.fetchPaymentCandidates.mockResolvedValue([
      makePaymentRow("payment-b", {
        received_by: "actor-b",
        documents: {
          id: "document-1",
          number: "INV-001",
          discount_kind: "percent",
          discount_value: "10",
        },
      }),
      makePaymentRow("payment-a", {
        received_by: "actor-a",
        documents: {
          id: "document-1",
          number: "INV-001",
          discount_kind: "percent",
          discount_value: "10",
        },
      }),
    ]);
    repository.fetchDiscountLines.mockResolvedValue([
      makeDiscountLine("line-1"),
    ]);
    repository.fetchCanonicalPayments.mockResolvedValue([
      makePaymentRow("payment-b", { received_by: "actor-b" }),
      makePaymentRow("payment-a", { received_by: "actor-a" }),
    ]);
    repository.fetchActorNames.mockImplementation(async (ids) =>
      ids.map((id) => ({ id, display_name: id === "actor-a" ? "Asha" : "Benoit" })),
    );

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(repository.fetchCanonicalPayments).toHaveBeenCalledWith("pos-1", [
      "document-1",
    ]);
    expect(
      result.trace.filter((event) => event.kind === "discount_applied"),
    ).toEqual([
      expect.objectContaining({
        key: "discount:document-1",
        actorName: "Asha",
      }),
    ]);
  });

  it("does not emit a discounted document whose canonical payment is outside the range", async () => {
    const repository = makeRepository();
    repository.fetchPaymentCandidates.mockResolvedValue([
      makePaymentRow("payment", {
        documents: {
          id: "document-1",
          number: "INV-001",
          discount_kind: "percent",
          discount_value: "10",
        },
      }),
    ]);
    repository.fetchCanonicalPayments.mockResolvedValue([
      makePaymentRow("canonical", {
        received_at: "2026-07-13T19:59:59.999Z",
      }),
    ]);

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(result.trace.some((event) => event.kind === "discount_applied")).toBe(
      false,
    );
  });

  it("includes complete pre-range session payments in an in-range close", async () => {
    const repository = makeRepository();
    repository.fetchSessionCloseCandidates.mockResolvedValue([
      makeSessionRow("session-old", {
        opened_at: "2026-07-13T08:00:00.000Z",
        closed_at: "2026-07-14T10:00:00.000Z",
      }),
    ]);
    const completePayments: TraceSessionPaymentRow[] = [
      {
        id: "before-range-card",
        cash_session_id: "session-old",
        method: "card",
        amount: "125.00",
      },
      {
        id: "before-range-cash",
        cash_session_id: "session-old",
        method: "cash",
        amount: "75.00",
      },
    ];
    repository.fetchClosingSessionPayments.mockResolvedValue(completePayments);

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(repository.fetchClosingSessionPayments).toHaveBeenCalledWith([
      "session-old",
    ]);
    expect(result.trace).toEqual([
      expect.objectContaining({
        key: "session-close:session-old",
        metadata: expect.arrayContaining([
          { label: "Card total", value: "Rs 125.00" },
        ]),
      }),
    ]);
  });

  it("globally caps before close enrichment and skips an off-cap close", async () => {
    const repository = makeRepository();
    repository.fetchAuditCandidates.mockResolvedValue(
      Array.from({ length: 150 }, (_, index) =>
        makeAuditRow(`audit-${String(index).padStart(3, "0")}`, {
          created_at: new Date(NOW - index * 1_000).toISOString(),
        }),
      ),
    );
    repository.fetchSessionCloseCandidates.mockResolvedValue([
      makeSessionRow("off-cap", {
        closed_at: new Date(NOW - 151_000).toISOString(),
      }),
    ]);

    const result = await loadDeviceTraceability("pos-1", RANGE, repository);

    expect(result.traceState).toMatchObject({ status: "ready", capped: true });
    expect(result.trace).toHaveLength(150);
    expect(result.trace.some((event) => event.key === "session-close:off-cap")).toBe(
      false,
    );
    expect(repository.fetchClosingSessionPayments).not.toHaveBeenCalled();
  });
});

interface RecordedOperation {
  name: string;
  args: unknown[];
}

interface RecordedQuery {
  table: string;
  tableOrdinal: number;
  operations: RecordedOperation[];
}

interface QueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

type QueryResponder = (
  query: RecordedQuery,
) => QueryResult | Promise<QueryResult>;

class RecordingQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly record: RecordedQuery,
    private readonly responder: QueryResponder,
  ) {}

  private add(name: string, ...args: unknown[]): this {
    this.record.operations.push({ name, args });
    return this;
  }

  select(...args: unknown[]): this {
    return this.add("select", ...args);
  }

  eq(...args: unknown[]): this {
    return this.add("eq", ...args);
  }

  gte(...args: unknown[]): this {
    return this.add("gte", ...args);
  }

  gt(...args: unknown[]): this {
    return this.add("gt", ...args);
  }

  lt(...args: unknown[]): this {
    return this.add("lt", ...args);
  }

  not(...args: unknown[]): this {
    return this.add("not", ...args);
  }

  in(...args: unknown[]): this {
    return this.add("in", ...args);
  }

  or(...args: unknown[]): this {
    return this.add("or", ...args);
  }

  order(...args: unknown[]): this {
    return this.add("order", ...args);
  }

  limit(...args: unknown[]): this {
    return this.add("limit", ...args);
  }

  range(...args: unknown[]): Promise<QueryResult> {
    this.add("range", ...args);
    return Promise.resolve(this.responder(this.record));
  }

  maybeSingle(): Promise<QueryResult> {
    this.add("maybeSingle");
    return Promise.resolve(this.responder(this.record));
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.responder(this.record)).then(
      onfulfilled,
      onrejected,
    );
  }
}

class RecordingSupabase {
  readonly queries: RecordedQuery[] = [];
  private readonly counts = new Map<string, number>();

  constructor(private readonly responder: QueryResponder) {}

  from(table: string): RecordingQuery {
    const tableOrdinal = this.counts.get(table) ?? 0;
    this.counts.set(table, tableOrdinal + 1);
    const record: RecordedQuery = { table, tableOrdinal, operations: [] };
    this.queries.push(record);
    return new RecordingQuery(record, this.responder);
  }
}

function operation(
  query: RecordedQuery,
  name: string,
  ...args: unknown[]
): RecordedOperation | undefined {
  return query.operations.find(
    (candidate) =>
      candidate.name === name &&
      args.every((arg, index) => candidate.args[index] === arg),
  );
}

function operations(query: RecordedQuery, name: string): RecordedOperation[] {
  return query.operations.filter((candidate) => candidate.name === name);
}

describe("createSupabaseTraceRepository", () => {
  it("uses an old range directly for every primary stream without a lifetime-session window", async () => {
    const client = new RecordingSupabase(() => ({ data: [], error: null }));
    const repository = createSupabaseTraceRepository(client);

    await repository.fetchAuditCandidates("pos-1", OLD_RANGE);
    await repository.fetchPaymentCandidates("pos-1", OLD_RANGE);
    await repository.fetchSessionOpenCandidates("pos-1", OLD_RANGE);
    await repository.fetchSessionCloseCandidates("pos-1", OLD_RANGE);

    const [audit, payment, opening, closing] = client.queries;
    expect(audit?.table).toBe("audit_events");
    expect(operation(audit!, "eq", "device_id", "pos-1")).toBeDefined();
    expect(operation(audit!, "gte", "created_at", OLD_RANGE.startIso)).toBeDefined();
    expect(
      operation(audit!, "lt", "created_at", OLD_RANGE.endExclusiveIso),
    ).toBeDefined();
    expect(
      operation(
        audit!,
        "not",
        "event_type",
        "in",
        "(payment_reversed,period_closed)",
      ),
    ).toBeDefined();
    expect(operations(audit!, "order").map(({ args }) => args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(operation(audit!, "limit", 151)).toBeDefined();

    expect(payment?.table).toBe("payments");
    expect(String(operation(payment!, "select")?.args[0])).toContain(
      "cash_sessions!inner(device_id)",
    );
    expect(
      operation(payment!, "eq", "cash_sessions.device_id", "pos-1"),
    ).toBeDefined();
    expect(
      operation(payment!, "gte", "received_at", OLD_RANGE.startIso),
    ).toBeDefined();
    expect(
      operation(payment!, "lt", "received_at", OLD_RANGE.endExclusiveIso),
    ).toBeDefined();
    expect(operations(payment!, "order").map(({ args }) => args)).toEqual([
      ["received_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(operation(payment!, "limit", 151)).toBeDefined();
    expect(operations(payment!, "in")).toEqual([]);

    expect(opening?.table).toBe("cash_sessions");
    expect(operation(opening!, "eq", "device_id", "pos-1")).toBeDefined();
    expect(
      operation(opening!, "gte", "opened_at", OLD_RANGE.startIso),
    ).toBeDefined();
    expect(
      operation(opening!, "lt", "opened_at", OLD_RANGE.endExclusiveIso),
    ).toBeDefined();
    expect(operations(opening!, "order").map(({ args }) => args)).toEqual([
      ["opened_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(operation(opening!, "limit", 151)).toBeDefined();

    expect(closing?.table).toBe("cash_sessions");
    expect(operation(closing!, "eq", "device_id", "pos-1")).toBeDefined();
    expect(
      operation(closing!, "gte", "closed_at", OLD_RANGE.startIso),
    ).toBeDefined();
    expect(
      operation(closing!, "lt", "closed_at", OLD_RANGE.endExclusiveIso),
    ).toBeDefined();
    expect(operations(closing!, "gte").some(({ args }) => args[0] === "opened_at")).toBe(
      false,
    );
    expect(operations(closing!, "order").map(({ args }) => args)).toEqual([
      ["closed_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(operation(closing!, "limit", 151)).toBeDefined();
  });

  const resultErrorCases: Array<{
    name: string;
    invoke: (repository: TraceRepository) => Promise<unknown>;
  }> = [
    {
      name: "audit candidates",
      invoke: (repository) => repository.fetchAuditCandidates("pos-1", RANGE),
    },
    {
      name: "payment candidates",
      invoke: (repository) =>
        repository.fetchPaymentCandidates("pos-1", RANGE),
    },
    {
      name: "session-open candidates",
      invoke: (repository) =>
        repository.fetchSessionOpenCandidates("pos-1", RANGE),
    },
    {
      name: "session-close candidates",
      invoke: (repository) =>
        repository.fetchSessionCloseCandidates("pos-1", RANGE),
    },
    {
      name: "reversal audits",
      invoke: (repository) => repository.fetchReversalAudits(["payment-1"]),
    },
    {
      name: "discount lines",
      invoke: (repository) => repository.fetchDiscountLines(["document-1"]),
    },
    {
      name: "canonical payments",
      invoke: (repository) =>
        repository.fetchCanonicalPayments("pos-1", ["document-1"]),
    },
    {
      name: "actor names",
      invoke: (repository) => repository.fetchActorNames(["actor-1"]),
    },
    {
      name: "closing-session payments",
      invoke: (repository) =>
        repository.fetchClosingSessionPayments(["session-1"]),
    },
  ];

  it.each(resultErrorCases)(
    "throws on a Supabase { data, error } result for $name",
    async ({ invoke }) => {
      const client = new RecordingSupabase(() => ({
        data: [],
        error: { message: "database read failed" },
      }));
      const repository = createSupabaseTraceRepository(client);

      await expect(invoke(repository)).rejects.toThrow("database read failed");
    },
  );

  it("returns empty conditional reads without ever constructing an empty .in()", async () => {
    const client = new RecordingSupabase(() => ({ data: [], error: null }));
    const repository = createSupabaseTraceRepository(client);

    await expect(repository.fetchReversalAudits([])).resolves.toEqual([]);
    await expect(repository.fetchDiscountLines([])).resolves.toEqual([]);
    await expect(
      repository.fetchCanonicalPayments("pos-1", []),
    ).resolves.toEqual([]);
    await expect(repository.fetchActorNames([])).resolves.toEqual([]);
    await expect(
      repository.fetchClosingSessionPayments([]),
    ).resolves.toEqual([]);
    expect(client.queries).toEqual([]);
  });

  it("pages document lines, variable-fraction canonical payments, and closing payments to exhaustion with fresh builders", async () => {
    const documentLines = Array.from({ length: 1_001 }, (_, index) =>
      makeDiscountLine(`line-${String(index).padStart(4, "0")}`),
    );
    const canonicalPayments = Array.from({ length: 1_001 }, (_, index) =>
      makePaymentRow(`payment-${String(index).padStart(4, "0")}`, {
        received_at:
          index === 1_000
            ? "2026-07-14T08:00:00.000100Z"
            : "2026-07-14T08:00:00.000Z",
      }),
    );
    const closingPayments: TraceSessionPaymentRow[] = Array.from(
      { length: 1_001 },
      (_, index) => ({
        id: `closing-${String(index).padStart(4, "0")}`,
        cash_session_id: "session-1",
        method: "card",
        amount: "1.00",
      }),
    );
    const rowsByTable = new Map<string, unknown[]>([
      ["document_lines", documentLines],
      ["payments", canonicalPayments],
      ["closing_payments", closingPayments],
    ]);
    const client = new RecordingSupabase((query) => {
      const table =
        query.table === "payments" &&
        String(operation(query, "select")?.args[0]).includes(
          "cash_session_id, method, amount",
        )
          ? "closing_payments"
          : query.table;
      const rows = rowsByTable.get(table) ?? [];
      return {
        data: rows.slice(query.tableOrdinal * 1_000, query.tableOrdinal * 1_000 + 1_000),
        error: null,
      };
    });
    const repository = createSupabaseTraceRepository(client);

    await expect(
      repository.fetchDiscountLines(["document-1"]),
    ).resolves.toHaveLength(1_001);
    await expect(
      repository.fetchCanonicalPayments("pos-1", ["document-1"]),
    ).resolves.toHaveLength(1_001);

    const closingClient = new RecordingSupabase((query) => ({
      data: closingPayments.slice(
        query.tableOrdinal * 1_000,
        query.tableOrdinal * 1_000 + 1_000,
      ),
      error: null,
    }));
    const closingRepository = createSupabaseTraceRepository(closingClient);
    await expect(
      closingRepository.fetchClosingSessionPayments(["session-1"]),
    ).resolves.toHaveLength(1_001);

    const lineQueries = client.queries.filter(
      (query) => query.table === "document_lines",
    );
    const canonicalQueries = client.queries.filter(
      (query) =>
        query.table === "payments" &&
        String(operation(query, "select")?.args[0]).includes(
          "documents(id, number, discount_kind, discount_value)",
        ),
    );
    expect(lineQueries).toHaveLength(2);
    expect(operation(lineQueries[1]!, "gt", "id")).toBeDefined();
    expect(lineQueries.every((query) => operation(query, "range", 0, 999))).toBe(
      true,
    );
    expect(canonicalQueries).toHaveLength(2);
    expect(operations(canonicalQueries[0]!, "order").map(({ args }) => args)).toEqual([
      ["received_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(operation(canonicalQueries[1]!, "or")).toBeDefined();

    expect(closingClient.queries).toHaveLength(2);
    expect(
      operation(closingClient.queries[1]!, "gt", "id"),
    ).toBeDefined();
    expect(
      closingClient.queries.every((query) => operation(query, "range", 0, 999)),
    ).toBe(true);
  });
});

describe("getDeviceTraceability", () => {
  beforeEach(() => {
    dependencyMocks.createClient.mockReset();
    dependencyMocks.getSessionContext.mockReset();
  });

  it.each([null, { role: "manager" }])(
    "returns unavailable before source reads for a non-owner session %#",
    async (session) => {
      dependencyMocks.getSessionContext.mockResolvedValue(session);

      const result = await getDeviceTraceability("pos-1", {
        from: "2026-07-14",
        to: "2026-07-14",
      });

      expect(dependencyMocks.getSessionContext).toHaveBeenCalledTimes(1);
      expect(dependencyMocks.createClient).not.toHaveBeenCalled();
      expect(result).toEqual({
        trace: [],
        traceState: {
          status: "unavailable",
          capped: false,
          range: { from: "2026-07-14", to: "2026-07-14" },
        },
      });
    },
  );

  it("uses the caller-scoped Supabase client only after owner authorization", async () => {
    const client = new RecordingSupabase(() => ({ data: [], error: null }));
    dependencyMocks.getSessionContext.mockResolvedValue({ role: "owner" });
    dependencyMocks.createClient.mockResolvedValue(client);

    const result = await getDeviceTraceability("pos-1", {
      from: "2026-07-14",
      to: "2026-07-14",
    });

    expect(dependencyMocks.getSessionContext).toHaveBeenCalledTimes(1);
    expect(dependencyMocks.createClient).toHaveBeenCalledTimes(1);
    expect(client.queries.map((query) => query.table).sort()).toEqual([
      "audit_events",
      "cash_sessions",
      "cash_sessions",
      "payments",
    ]);
    expect(result).toMatchObject({
      trace: [],
      traceState: { status: "ready", capped: false },
    });
  });
});

describe("getDeviceDashboard last activity", () => {
  beforeEach(() => {
    dependencyMocks.createClient.mockReset();
    dependencyMocks.getSessionContext.mockReset();
  });

  it("uses one cheap lifetime audit plus existing recent rows without trace enrichment", async () => {
    const session = {
      id: "session-1",
      device_id: "back-office",
      status: "open",
      opened_at: "2026-07-14T06:00:00.000Z",
      opened_by: "actor-1",
      opening_float: "1000.00",
      closed_at: null,
      closed_by: null,
      expected_cash: null,
      closing_count: null,
      variance: null,
    };
    const payment = makePaymentRow("payment-latest", {
      cash_session_id: "session-1",
      received_at: "2026-07-14T09:00:00.000Z",
      received_by: "actor-1",
    });
    const client = new RecordingSupabase((query) => {
      switch (query.table) {
        case "business_settings":
        case "devices":
        case "period_closes":
        case "till_movements":
          return { data: [], error: null };
        case "cash_sessions":
          return {
            data: query.tableOrdinal === 0 ? [] : [session],
            error: null,
          };
        case "app_users":
          return {
            data: [{ id: "actor-1", display_name: "Asha" }],
            error: null,
          };
        case "payments":
          return { data: [payment], error: null };
        case "audit_events":
          return {
            data: [
              makeAuditRow("latest-audit", {
                event_type: "terminal_started",
                created_at: "2026-07-14T08:00:00.000Z",
                actor_id: "actor-1",
                payload: { model: "Samsung Tab A9", app_version: "2.4.1" },
              }),
            ],
            error: null,
          };
        default:
          throw new Error(`Unexpected table ${query.table}`);
      }
    });
    dependencyMocks.createClient.mockResolvedValue(client);

    const result = await getDeviceDashboard("back-office");

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("trace");
    expect(result?.lastActivity).toMatchObject({
      at: "2026-07-14T09:00:00.000Z",
      title: "Payment received",
    });

    const auditQueries = client.queries.filter(
      (query) => query.table === "audit_events",
    );
    expect(auditQueries).toHaveLength(1);
    expect(operation(auditQueries[0]!, "limit", 1)).toBeDefined();
    expect(operations(auditQueries[0]!, "order").map(({ args }) => args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(operations(auditQueries[0]!, "gte")).toEqual([]);
    expect(operations(auditQueries[0]!, "lt")).toEqual([]);
    expect(
      client.queries.some((query) => query.table === "document_lines"),
    ).toBe(false);
    expect(
      client.queries.some((query) =>
        operations(query, "in").some(({ args }) => args[0] === "ref_id"),
      ),
    ).toBe(false);
  });
});
