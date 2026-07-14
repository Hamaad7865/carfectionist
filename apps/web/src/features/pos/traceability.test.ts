import { describe, expect, it } from "vitest";
import {
  buildTraceCategoryHref,
  filterTraceEvents,
  groupTraceEventsByMauritiusDay,
  mapAuditTraceEvent,
  mapDiscountTraceEvent,
  mapPaymentTraceEvent,
  mapSessionCloseTraceEvent,
  mapSessionOpenTraceEvent,
  normalizeTraceRange,
  resolveTraceFilter,
  selectNewestTraceEvents,
  sortTraceEvents,
  summarizeTraceEvents,
  type TraceAuditRow,
  type TraceDiscountLineRow,
  type TraceEvent,
  type TracePaymentRow,
  type TraceSessionPaymentRow,
  type TraceSessionRow,
} from "./traceability";

const NOW = Date.parse("2026-07-14T08:00:00.000Z");

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    key: "event:base",
    at: "2026-07-14T08:00:00.000Z",
    atLabel: "2026-07-14 12:00",
    kind: "period_opened",
    category: "system",
    tone: "system",
    status: null,
    title: "Event",
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

function makeEvents(count: number): TraceEvent[] {
  return Array.from({ length: count }, (_, index) =>
    makeEvent({
      key: `event:${String(index).padStart(3, "0")}`,
      at: new Date(NOW - index * 1_000).toISOString(),
    }),
  );
}

const TRACE_AT = "2026-07-14T08:00:00.000Z";
const TRACE_AT_LABEL = "2026-07-14 12:00";

const mapperContext = {
  actorNames: new Map([
    ["actor-1", "Asha"],
    ["actor-2", "Benoit"],
    ["actor-3", "Anshika"],
  ]),
  documentIdsByNumber: new Map([["INV-001", "document-1"]]),
  reversalAudits: [] as TraceAuditRow[],
  sessionPayments: [] as TraceSessionPaymentRow[],
};

function makeAuditRow(
  eventType: string,
  payload: unknown = {},
  overrides: Partial<TraceAuditRow> = {},
): TraceAuditRow {
  return {
    id: eventType,
    event_type: eventType,
    payload,
    created_at: TRACE_AT,
    actor_id: "actor-1",
    ref_id: null,
    ...overrides,
  };
}

function makePaymentRow(
  overrides: Partial<TracePaymentRow> = {},
): TracePaymentRow {
  return {
    id: "payment-1",
    cash_session_id: "session-1",
    document_id: "document-1",
    method: "cash",
    amount: "25.00",
    received_at: TRACE_AT,
    received_by: "actor-1",
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
  overrides: Partial<TraceSessionRow> = {},
): TraceSessionRow {
  return {
    id: "session-1",
    device_id: "pos-1",
    opened_at: TRACE_AT,
    opened_by: "actor-1",
    opening_float: "1000.00",
    closed_at: "2026-07-14T16:00:00.000Z",
    closed_by: "actor-2",
    expected_cash: "1425.50",
    closing_count: "1420.25",
    variance: "-5.25",
    ...overrides,
  };
}

function makeDiscountLine(
  overrides: Partial<TraceDiscountLineRow> = {},
): TraceDiscountLineRow {
  return {
    id: "line-1",
    document_id: "document-1",
    title: "Brake pads",
    discount_pct: "5",
    discount_kind: "percent",
    discount_amount: null,
    ...overrides,
  };
}

describe("trace source mappers", () => {
  describe("mapAuditTraceEvent", () => {
    it.each([
      {
        source: "terminal_started",
        row: makeAuditRow("terminal_started", {
          model: "Samsung Tab A9",
          app_version: "2.4.1",
        }),
        expected: makeEvent({
          key: "audit:terminal_started",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "terminal_started",
          category: "system",
          tone: "system",
          title: "Terminal started",
          actorName: "Asha",
          metadata: [
            { label: "Model", value: "Samsung Tab A9" },
            { label: "App version", value: "2.4.1" },
          ],
        }),
      },
      {
        source: "app_version_changed",
        row: makeAuditRow("app_version_changed", {
          from: "2.4.0",
          to: "2.4.1",
        }),
        expected: makeEvent({
          key: "audit:app_version_changed",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "version_changed",
          category: "system",
          tone: "system",
          title: "App version changed",
          actorName: "Asha",
          metadata: [
            { label: "Previous version", value: "2.4.0" },
            { label: "New version", value: "2.4.1" },
          ],
        }),
      },
      {
        source: "signed_in",
        row: makeAuditRow("signed_in", { device: "pos" }),
        expected: makeEvent({
          key: "audit:signed_in",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "operator_signed_in",
          category: "system",
          tone: "system",
          title: "Operator signed in",
          actorName: "Asha",
        }),
      },
      {
        source: "device_enabled",
        row: makeAuditRow("device_enabled"),
        expected: makeEvent({
          key: "audit:device_enabled",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "device_enabled",
          category: "system",
          tone: "system",
          title: "Device enabled",
          actorName: "Asha",
        }),
      },
      {
        source: "device_disabled",
        row: makeAuditRow("device_disabled", {
          reason: "Tablet retired",
        }),
        expected: makeEvent({
          key: "audit:device_disabled",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "device_disabled",
          category: "system",
          tone: "warning",
          status: "disabled",
          title: "Device disabled",
          actorName: "Asha",
          reason: "Tablet retired",
        }),
      },
      {
        source: "till_cash_out",
        row: makeAuditRow("till_cash_out", {
          amount: "25.50",
          reason: "Cleaning supplies",
        }),
        expected: makeEvent({
          key: "audit:till_cash_out",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "cash_out",
          category: "till",
          tone: "till",
          title: "Cash out",
          actorName: "Asha",
          amountCents: -2_550,
          reason: "Cleaning supplies",
        }),
      },
      {
        source: "receipt_printed",
        row: makeAuditRow("receipt_printed", { number: "INV-001" }),
        expected: makeEvent({
          key: "audit:receipt_printed",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "receipt_printed",
          category: "receipts",
          tone: "receipt",
          title: "Receipt printed",
          reference: "INV-001",
          href: "/sales/document-1",
        }),
      },
      {
        source: "receipt_skipped",
        row: makeAuditRow("receipt_skipped", { number: "INV-001" }),
        expected: makeEvent({
          key: "audit:receipt_skipped",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "receipt_skipped",
          category: "receipts",
          tone: "warning",
          status: "receipt_skipped",
          title: "Receipt skipped",
          reference: "INV-001",
          href: "/sales/document-1",
        }),
      },
      {
        source: "receipt_emailed",
        row: makeAuditRow(
          "receipt_emailed",
          { number: "INV-002", to: "client@example.com" },
          { ref_id: "document-2" },
        ),
        expected: makeEvent({
          key: "audit:receipt_emailed",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "receipt_emailed",
          category: "receipts",
          tone: "receipt",
          title: "Receipt emailed",
          actorName: "Asha",
          reference: "INV-002",
          metadata: [{ label: "Recipient", value: "client@example.com" }],
          href: "/sales/document-2",
        }),
      },
      {
        source: "document_sent",
        row: makeAuditRow(
          "document_sent",
          {
            number: "INV-003",
            channel: "whatsapp",
            to: "+230 5555 0101",
          },
          { ref_id: "document-3" },
        ),
        expected: makeEvent({
          key: "audit:document_sent",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "document_sent",
          category: "receipts",
          tone: "receipt",
          title: "Document sent",
          actorName: "Asha",
          reference: "INV-003",
          metadata: [
            { label: "Channel", value: "WhatsApp" },
            { label: "Recipient", value: "+230 5555 0101" },
          ],
          href: "/sales/document-3",
        }),
      },
      {
        source: "data_export",
        row: makeAuditRow("data_export", {
          report: "sales",
          from: "2026-07-01",
          to: "2026-07-14",
        }),
        expected: makeEvent({
          key: "audit:data_export",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "data_export",
          category: "system",
          tone: "system",
          title: "Data exported",
          actorName: "Asha",
          metadata: [
            { label: "Report", value: "sales" },
            { label: "From", value: "2026-07-01" },
            { label: "To", value: "2026-07-14" },
          ],
        }),
      },
      {
        source: "an unknown audit type",
        row: makeAuditRow(
          "custom_sync_completed",
          { secret: "raw JSON must stay hidden" },
          { ref_id: "untrusted-document-id" },
        ),
        expected: makeEvent({
          key: "audit:custom_sync_completed",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "custom_sync_completed",
          category: "system",
          tone: "system",
          title: "Custom sync completed",
          actorName: "Asha",
        }),
      },
    ])("maps $source to the complete structured contract", ({ row, expected }) => {
      expect(mapAuditTraceEvent(row, mapperContext)).toEqual(expected);
    });

    it("uses the retained audit row id rather than the event type in its key", () => {
      const row = makeAuditRow(
        "terminal_started",
        { model: "Samsung Tab A9" },
        { id: "audit-row-42" },
      );

      expect(mapAuditTraceEvent(row, mapperContext)?.key).toBe(
        "audit:audit-row-42",
      );
    });

    it.each(["payment_reversed", "period_closed"])(
      "suppresses duplicate or globally-attributed %s audits",
      (eventType) => {
        expect(
          mapAuditTraceEvent(makeAuditRow(eventType), mapperContext),
        ).toBeNull();
      },
    );

    it("does not let null or malformed payload numerics invent zero", () => {
      expect(
        mapAuditTraceEvent(
          makeAuditRow("till_cash_out", {
            amount: null,
            reason: { unsafe: true },
          }),
          mapperContext,
        ),
      ).toEqual(
        makeEvent({
          key: "audit:till_cash_out",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "cash_out",
          category: "till",
          tone: "till",
          title: "Cash out",
          actorName: "Asha",
        }),
      );

      expect(
        mapAuditTraceEvent(
          makeAuditRow("till_cash_out", {
            amount: "not-a-number",
            reason: "Damaged stock",
          }),
          mapperContext,
        )?.amountCents,
      ).toBeNull();
    });

    it("requires a trustworthy receipt document identity or number match", () => {
      expect(
        mapAuditTraceEvent(
          makeAuditRow(
            "receipt_printed",
            { number: "INV-404" },
            { ref_id: "untrusted-document-id" },
          ),
          mapperContext,
        )?.href,
      ).toBeNull();
      expect(
        mapAuditTraceEvent(
          makeAuditRow("receipt_emailed", {
            number: "INV-404",
            to: "client@example.com",
          }),
          mapperContext,
        )?.href,
      ).toBeNull();
    });

    it("handles non-object audit payloads without exposing raw values", () => {
      expect(
        mapAuditTraceEvent(
          makeAuditRow("terminal_started", ["Samsung", "2.4.1"]),
          mapperContext,
        ),
      ).toEqual(
        makeEvent({
          key: "audit:terminal_started",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "terminal_started",
          category: "system",
          tone: "system",
          title: "Terminal started",
          actorName: "Asha",
        }),
      );
    });

    it("never reads inherited channel labels from the dictionary prototype", () => {
      const event = mapAuditTraceEvent(
        makeAuditRow("document_sent", {
          number: "INV-001",
          channel: "constructor",
        }),
        mapperContext,
      );

      expect(event?.metadata).toContainEqual({
        label: "Channel",
        value: "Constructor",
      });
      expect(typeof event?.metadata[0]?.value).toBe("string");
    });
  });

  describe("mapPaymentTraceEvent", () => {
    it("maps a positive ledger row without flattening structured values", () => {
      expect(mapPaymentTraceEvent(makePaymentRow(), mapperContext)).toEqual(
        makeEvent({
          key: "payment:payment-1",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "payment_received",
          category: "payments",
          tone: "payment",
          title: "Payment received",
          actorName: "Asha",
          amountCents: 2_500,
          method: "Cash",
          reference: "INV-001",
          href: "/sales/document-1",
        }),
      );
    });

    it("keeps a negative ledger value and merges reversal actor and reason", () => {
      const reversalAudit = makeAuditRow(
        "payment_reversed",
        { reason: "Entered twice" },
        { id: "reversal-audit", actor_id: "actor-2", ref_id: "payment-original" },
      );
      const negativePayment = makePaymentRow({
        id: "payment-reversal",
        amount: "-25.00",
        method: "card",
        reverses_payment_id: "payment-original",
      });

      expect(
        mapPaymentTraceEvent(negativePayment, {
          ...mapperContext,
          reversalAudits: [reversalAudit],
        }),
      ).toEqual(
        makeEvent({
          key: "payment:payment-reversal",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "payment_reversed",
          category: "payments",
          tone: "warning",
          status: "reversed",
          title: "Payment reversed",
          actorName: "Benoit",
          amountCents: -2_500,
          method: "Card",
          reference: "INV-001",
          reason: "Entered twice",
          href: "/sales/document-1",
        }),
      );
    });

    it("keeps a missing reversal match exceptional with a required fallback reason", () => {
      const negativePayment = makePaymentRow({
        id: "payment-reversal",
        amount: -25,
        reverses_payment_id: "missing-original",
      });

      expect(mapPaymentTraceEvent(negativePayment, mapperContext)).toMatchObject({
        key: "payment:payment-reversal",
        kind: "payment_reversed",
        tone: "warning",
        status: "reversed",
        actorName: "Asha",
        amountCents: -2_500,
        reason: "Reason unavailable",
      });
    });

    it("classifies a positive ledger row as received even with a reversal pointer", () => {
      expect(
        mapPaymentTraceEvent(
          makePaymentRow({
            amount: "25.00",
            reverses_payment_id: "payment-original",
          }),
          mapperContext,
        ),
      ).toMatchObject({
        kind: "payment_received",
        tone: "payment",
        status: null,
        amountCents: 2_500,
        actorName: "Asha",
        reason: null,
      });
    });

    it("does not match a null reversal pointer to an unrelated null audit ref", () => {
      const unrelatedAudit = makeAuditRow(
        "payment_reversed",
        { reason: "Unrelated reversal" },
        { id: "unrelated-audit", actor_id: "actor-2", ref_id: null },
      );

      expect(
        mapPaymentTraceEvent(makePaymentRow({ amount: "-25.00" }), {
          ...mapperContext,
          reversalAudits: [unrelatedAudit],
        }),
      ).toMatchObject({
        kind: "payment_reversed",
        actorName: "Asha",
        amountCents: -2_500,
        reason: "Reason unavailable",
      });
    });

    it("never reads inherited method labels from the dictionary prototype", () => {
      const event = mapPaymentTraceEvent(
        makePaymentRow({ method: "__proto__" }),
        mapperContext,
      );

      expect(event.method).toBe("Proto");
      expect(typeof event.method).toBe("string");
    });

    it("does not coerce a defensive null amount to zero", () => {
      const malformed = makePaymentRow({
        amount: null as unknown as string,
      });

      expect(mapPaymentTraceEvent(malformed, mapperContext)?.amountCents).toBeNull();
    });
  });

  describe("session mappers", () => {
    it("maps the till opening with a positive float and session metadata", () => {
      expect(mapSessionOpenTraceEvent(makeSessionRow(), mapperContext)).toEqual(
        makeEvent({
          key: "session-open:session-1",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "till_opened",
          category: "till",
          tone: "till",
          title: "Till opened",
          actorName: "Asha",
          amountCents: 100_000,
          metadata: [{ label: "Session ID", value: "session-1" }],
        }),
      );
    });

    it("does not invent a zero opening float from a defensive null", () => {
      expect(
        mapSessionOpenTraceEvent(
          makeSessionRow({ opening_float: null as unknown as string }),
          mapperContext,
        ).amountCents,
      ).toBeNull();
    });

    it("maps a signed non-zero variance as the only exceptional close", () => {
      const sessionPayments: TraceSessionPaymentRow[] = [
        {
          id: "payment-card",
          cash_session_id: "session-1",
          method: "card",
          amount: "200.00",
        },
        {
          id: "payment-card-reversal",
          cash_session_id: "session-1",
          method: "card",
          amount: "-50.00",
        },
        {
          id: "payment-juice",
          cash_session_id: "session-1",
          method: "juice",
          amount: 30,
        },
        {
          id: "payment-cash",
          cash_session_id: "session-1",
          method: "cash",
          amount: 400,
        },
      ];

      expect(
        mapSessionCloseTraceEvent(makeSessionRow(), {
          ...mapperContext,
          sessionPayments,
        }),
      ).toEqual(
        makeEvent({
          key: "session-close:session-1",
          at: "2026-07-14T16:00:00.000Z",
          atLabel: "2026-07-14 20:00",
          kind: "till_closed",
          category: "till",
          tone: "warning",
          status: "variance",
          title: "Till closed",
          actorName: "Benoit",
          amountCents: -525,
          metadata: [
            { label: "Expected cash", value: "Rs 1,425.50" },
            { label: "Counted cash", value: "Rs 1,420.25" },
            { label: "Card total", value: "Rs 150.00" },
            { label: "Juice total", value: "Rs 30.00" },
          ],
        }),
      );
    });

    it("keeps a zero-variance close normal", () => {
      expect(
        mapSessionCloseTraceEvent(
          makeSessionRow({ variance: "0" }),
          mapperContext,
        ),
      ).toMatchObject({
        kind: "till_closed",
        tone: "till",
        status: null,
        amountCents: 0,
      });
    });

    it("keeps null close numerics null and does not invent a variance", () => {
      expect(
        mapSessionCloseTraceEvent(
          makeSessionRow({
            expected_cash: null,
            closing_count: null,
            variance: null,
          }),
          mapperContext,
        ),
      ).toMatchObject({
        tone: "till",
        status: null,
        amountCents: null,
        metadata: [],
      });
    });

    it("does not emit a close card without a close timestamp", () => {
      expect(
        mapSessionCloseTraceEvent(
          makeSessionRow({ closed_at: null }),
          mapperContext,
        ),
      ).toBeNull();
    });
  });

  describe("mapDiscountTraceEvent", () => {
    it("emits one mixed-discount card using the canonical same-time payment", () => {
      const sameTimePayments = [
        makePaymentRow({
          id: "payment-b",
          received_by: "actor-1",
          documents: {
            id: "document-1",
            number: "INV-001",
            discount_kind: "percent",
            discount_value: "10",
          },
        }),
        makePaymentRow({
          id: "payment-a",
          method: "card",
          received_by: "actor-3",
          documents: {
            id: "document-1",
            number: "INV-001",
            discount_kind: "percent",
            discount_value: "10",
          },
        }),
      ];
      const lines = [
        makeDiscountLine(),
        makeDiscountLine({
          id: "line-2",
          title: "Oil filter",
          discount_kind: "amount",
          discount_pct: null,
          discount_amount: "75.50",
        }),
        makeDiscountLine({
          id: "line-invalid",
          title: "Invalid line",
          discount_pct: null,
        }),
        makeDiscountLine({
          id: "line-other-document",
          document_id: "document-2",
          title: "Other document",
        }),
      ];

      const discounts = [
        mapDiscountTraceEvent(
          "document-1",
          sameTimePayments,
          lines,
          mapperContext,
        ),
      ].filter((event): event is TraceEvent => event !== null);

      expect(discounts).toEqual([
        makeEvent({
          key: "discount:document-1",
          at: TRACE_AT,
          atLabel: TRACE_AT_LABEL,
          kind: "discount_applied",
          category: "payments",
          tone: "payment",
          title: "Discount applied",
          actorName: "Anshika",
          reference: "INV-001",
          metadata: [
            { label: "Whole sale", value: "10%" },
            { label: "Brake pads", value: "5%" },
            { label: "Oil filter", value: "Rs 75.50" },
          ],
          href: "/sales/document-1",
        }),
      ]);
    });

    it("returns null without a positive canonical payment or truthful discount", () => {
      expect(
        mapDiscountTraceEvent(
          "document-1",
          [makePaymentRow({ amount: "-25.00" })],
          [makeDiscountLine()],
          mapperContext,
        ),
      ).toBeNull();
      expect(
        mapDiscountTraceEvent(
          "document-1",
          [makePaymentRow()],
          [makeDiscountLine({ discount_pct: null })],
          mapperContext,
        ),
      ).toBeNull();
    });

    it("preserves PostgreSQL microseconds when selecting the canonical payment", () => {
      const payments = [
        makePaymentRow({
          id: "payment-z",
          received_at: "2026-07-14T08:00:00.000100Z",
          received_by: "actor-3",
        }),
        makePaymentRow({
          id: "payment-a",
          received_at: "2026-07-14T08:00:00.000900Z",
          received_by: "actor-1",
        }),
      ];

      expect(
        mapDiscountTraceEvent(
          "document-1",
          payments,
          [makeDiscountLine()],
          mapperContext,
        ),
      ).toMatchObject({
        at: "2026-07-14T08:00:00.000100Z",
        actorName: "Anshika",
      });
    });

    it("normalizes variable fractional precision for canonical ASC ordering", () => {
      const payments = [
        makePaymentRow({
          id: "payment-z",
          received_at: "2026-07-14T08:00:00.000Z",
          received_by: "actor-3",
        }),
        makePaymentRow({
          id: "payment-a",
          received_at: "2026-07-14T08:00:00.000100Z",
          received_by: "actor-1",
        }),
      ];

      expect(
        mapDiscountTraceEvent(
          "document-1",
          payments,
          [makeDiscountLine()],
          mapperContext,
        ),
      ).toMatchObject({
        at: "2026-07-14T08:00:00.000Z",
        actorName: "Anshika",
      });
    });

    it("does not treat null fixed discounts as zero-valued metadata", () => {
      const payment = makePaymentRow({
        documents: {
          id: "document-1",
          number: "INV-001",
          discount_kind: "amount",
          discount_value: null,
        },
      });

      expect(
        mapDiscountTraceEvent(
          "document-1",
          [payment],
          [
            makeDiscountLine({
              discount_kind: "amount",
              discount_pct: null,
              discount_amount: null,
            }),
          ],
          mapperContext,
        ),
      ).toBeNull();
    });
  });
});

describe("normalizeTraceRange", () => {
  it("defaults a missing range to the current Mauritius day", () => {
    expect(normalizeTraceRange({}, NOW)).toEqual({
      from: "2026-07-14",
      to: "2026-07-14",
      startIso: "2026-07-13T20:00:00.000Z",
      endExclusiveIso: "2026-07-14T20:00:00.000Z",
    });
  });

  it("rejects malformed, impossible, and array date values", () => {
    expect(
      normalizeTraceRange(
        { from: "2026-7-14", to: "2026/07/14" },
        NOW,
      ),
    ).toMatchObject({ from: "2026-07-14", to: "2026-07-14" });

    expect(
      normalizeTraceRange(
        { from: "2026-02-30", to: "2026-07-10" },
        NOW,
      ),
    ).toMatchObject({ from: "2026-07-10", to: "2026-07-10" });

    expect(
      normalizeTraceRange(
        { from: ["2026-07-10"], to: "2026-07-11" },
        NOW,
      ),
    ).toMatchObject({ from: "2026-07-11", to: "2026-07-11" });
  });

  it("uses the one valid day for both sides of a partial range", () => {
    expect(
      normalizeTraceRange({ from: "2026-07-10" }, NOW),
    ).toMatchObject({ from: "2026-07-10", to: "2026-07-10" });
    expect(normalizeTraceRange({ to: "2026-07-11" }, NOW)).toMatchObject({
      from: "2026-07-11",
      to: "2026-07-11",
    });
  });

  it("swaps reversed valid boundaries", () => {
    expect(
      normalizeTraceRange(
        { from: "2026-07-14", to: "2026-07-12" },
        NOW,
      ),
    ).toMatchObject({ from: "2026-07-12", to: "2026-07-14" });
  });

  it("round-trips leap days and rejects non-leap February 29", () => {
    expect(
      normalizeTraceRange(
        { from: "2024-02-29", to: "2024-03-01" },
        NOW,
      ),
    ).toEqual({
      from: "2024-02-29",
      to: "2024-03-01",
      startIso: "2024-02-28T20:00:00.000Z",
      endExclusiveIso: "2024-03-01T20:00:00.000Z",
    });
    expect(
      normalizeTraceRange(
        { from: "2025-02-29", to: "2025-03-01" },
        NOW,
      ),
    ).toMatchObject({ from: "2025-03-01", to: "2025-03-01" });
  });

  it("converts a valid inclusive Mauritius range to exact half-open ISO bounds", () => {
    expect(
      normalizeTraceRange(
        { from: "2026-07-10", to: "2026-07-12" },
        NOW,
      ),
    ).toEqual({
      from: "2026-07-10",
      to: "2026-07-12",
      startIso: "2026-07-09T20:00:00.000Z",
      endExclusiveIso: "2026-07-12T20:00:00.000Z",
    });
  });
});

describe("trace selection", () => {
  it("sorts newest first and uses descending keys for equal timestamps", () => {
    const input = [
      makeEvent({ key: "event:a", at: "2026-07-14T07:00:00.000Z" }),
      makeEvent({ key: "event:b", at: "2026-07-14T08:00:00.000Z" }),
      makeEvent({ key: "event:c", at: "2026-07-14T08:00:00.000Z" }),
    ];

    expect(sortTraceEvents(input).map((event) => event.key)).toEqual([
      "event:c",
      "event:b",
      "event:a",
    ]);
    expect(input.map((event) => event.key)).toEqual([
      "event:a",
      "event:b",
      "event:c",
    ]);
  });

  it("preserves PostgreSQL microseconds in the global event order", () => {
    const input = [
      makeEvent({
        key: "event:z",
        at: "2026-07-14T08:00:00.000100Z",
      }),
      makeEvent({
        key: "event:a",
        at: "2026-07-14T08:00:00.000900Z",
      }),
    ];

    expect(sortTraceEvents(input).map((event) => event.key)).toEqual([
      "event:a",
      "event:z",
    ]);
  });

  it("normalizes variable fractional precision for global DESC ordering", () => {
    const input = [
      makeEvent({ key: "event:z", at: "2026-07-14T08:00:00.000Z" }),
      makeEvent({
        key: "event:a",
        at: "2026-07-14T08:00:00.000100Z",
      }),
    ];

    expect(sortTraceEvents(input).map((event) => event.key)).toEqual([
      "event:a",
      "event:z",
    ]);
  });

  it("uses the stable key for equal instants in different timezone forms", () => {
    const input = [
      makeEvent({
        key: "event:a",
        at: "2026-07-14T12:00:00.000100+04:00",
      }),
      makeEvent({
        key: "event:z",
        at: "2026-07-14T08:00:00.000100Z",
      }),
    ];

    expect(sortTraceEvents(input).map((event) => event.key)).toEqual([
      "event:z",
      "event:a",
    ]);
  });

  it("caps a globally sorted selection at 150 events", () => {
    const selected = selectNewestTraceEvents(makeEvents(151));

    expect(selected).toMatchObject({ capped: true });
    expect(selected.events).toHaveLength(150);
    expect(selected.events[0]?.key).toBe("event:000");
    expect(selected.events.at(-1)?.key).toBe("event:149");
    expect(selectNewestTraceEvents(makeEvents(150)).capped).toBe(false);
  });
});

describe("trace filters and summaries", () => {
  const events = [
    makeEvent({
      key: "payment:received",
      kind: "payment_received",
      category: "payments",
      tone: "payment",
      amountCents: 10_000,
    }),
    makeEvent({
      key: "payment:reversed",
      kind: "payment_reversed",
      category: "payments",
      tone: "warning",
      amountCents: -1_500,
    }),
    makeEvent({
      key: "receipt:printed",
      kind: "receipt_printed",
      category: "receipts",
      tone: "receipt",
    }),
    makeEvent({
      key: "receipt:skipped",
      kind: "receipt_skipped",
      category: "receipts",
      tone: "warning",
      status: "receipt_skipped",
    }),
    makeEvent({
      key: "receipt:emailed",
      kind: "receipt_emailed",
      category: "receipts",
      tone: "receipt",
    }),
    makeEvent({
      key: "receipt:sent",
      kind: "document_sent",
      category: "receipts",
      tone: "receipt",
    }),
  ];

  it("resolves only supported scalar filters", () => {
    expect(resolveTraceFilter("payments")).toBe("payments");
    expect(resolveTraceFilter("exceptions")).toBe("exceptions");
    expect(resolveTraceFilter("unknown")).toBe("all");
    expect(resolveTraceFilter(["payments"])).toBe("all");
    expect(resolveTraceFilter(undefined)).toBe("all");
  });

  it("filters by category or exception status after selection", () => {
    expect(filterTraceEvents(events, "all")).toHaveLength(events.length);
    expect(
      filterTraceEvents(events, "payments").map((event) => event.key),
    ).toEqual(["payment:received", "payment:reversed"]);
    expect(
      filterTraceEvents(events, "receipts").map((event) => event.key),
    ).toEqual([
      "receipt:printed",
      "receipt:skipped",
      "receipt:emailed",
      "receipt:sent",
    ]);
    expect(
      filterTraceEvents(events, "exceptions").map((event) => event.key),
    ).toEqual(["receipt:skipped"]);
  });

  it("uses the exact payment, receipt, and exception summary predicates", () => {
    expect(summarizeTraceEvents(events)).toEqual({
      events: events.length,
      netPaymentsCents: 8_500,
      receipts: 3,
      exceptions: 1,
    });
  });
});

describe("groupTraceEventsByMauritiusDay", () => {
  it("groups on Mauritius midnight and keeps deterministic chronology", () => {
    const groups = groupTraceEventsByMauritiusDay([
      makeEvent({
        key: "event:before-midnight",
        at: "2026-07-13T19:59:59.000Z",
      }),
      makeEvent({
        key: "event:midnight",
        at: "2026-07-13T20:00:00.000Z",
      }),
      makeEvent({
        key: "event:next-midnight",
        at: "2026-07-14T20:00:00.000Z",
      }),
    ]);

    expect(
      groups.map((group) => ({
        date: group.date,
        keys: group.events.map((event) => event.key),
      })),
    ).toEqual([
      { date: "2026-07-15", keys: ["event:next-midnight"] },
      { date: "2026-07-14", keys: ["event:midnight"] },
      { date: "2026-07-13", keys: ["event:before-midnight"] },
    ]);
  });
});

describe("buildTraceCategoryHref", () => {
  it("preserves repeated query parameters and forces the trace tab", () => {
    const href = buildTraceCategoryHref(
      {
        tab: ["general", "settings"],
        from: "2026-07-10",
        tag: ["first", "second"],
        traceCategory: "payments",
        ignored: undefined,
      },
      "exceptions",
    );
    const params = new URLSearchParams(href.slice(1));

    expect(params.getAll("tag")).toEqual(["first", "second"]);
    expect(params.getAll("tab")).toEqual(["trace"]);
    expect(params.get("from")).toBe("2026-07-10");
    expect(params.getAll("traceCategory")).toEqual(["exceptions"]);
  });

  it("removes only traceCategory for the all filter", () => {
    const href = buildTraceCategoryHref(
      {
        tab: "general",
        from: "2026-07-10",
        to: "2026-07-12",
        tag: ["first", "second"],
        traceCategory: ["payments", "receipts"],
      },
      "all",
    );
    const params = new URLSearchParams(href.slice(1));

    expect(params.get("tab")).toBe("trace");
    expect(params.get("from")).toBe("2026-07-10");
    expect(params.get("to")).toBe("2026-07-12");
    expect(params.getAll("tag")).toEqual(["first", "second"]);
    expect(params.has("traceCategory")).toBe(false);
  });
});
