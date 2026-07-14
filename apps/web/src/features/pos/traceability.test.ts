import { describe, expect, it } from "vitest";
import {
  buildTraceCategoryHref,
  filterTraceEvents,
  groupTraceEventsByMauritiusDay,
  normalizeTraceRange,
  resolveTraceFilter,
  selectNewestTraceEvents,
  sortTraceEvents,
  summarizeTraceEvents,
  type TraceEvent,
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
