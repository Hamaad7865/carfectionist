import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  TraceEvent,
  TraceFilter,
  TraceQueryParams,
  TraceState,
} from "./traceability";
import { TraceabilityPanel } from "./TraceabilityPanel";

const navigation = vi.hoisted(() => ({
  pathname: "/point-of-sale/POS-1",
  query: "tab=trace",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const READY: TraceState = {
  status: "ready",
  capped: false,
  range: { from: "2026-07-13", to: "2026-07-14" },
};

const QUERY: TraceQueryParams = {
  tab: "trace",
  from: "2026-07-13",
  to: "2026-07-14",
};

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    key: "event:base",
    at: "2026-07-13T21:15:00.000Z",
    atLabel: "2026-07-14 01:15",
    kind: "terminal_started",
    category: "system",
    tone: "system",
    status: null,
    title: "Terminal started",
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

function renderPanel({
  events = [],
  traceState = READY,
  activeCategory = "all",
  currentQuery = QUERY,
}: {
  events?: readonly TraceEvent[];
  traceState?: TraceState;
  activeCategory?: TraceFilter;
  currentQuery?: TraceQueryParams;
} = {}): string {
  return renderToStaticMarkup(
    <TraceabilityPanel
      events={events}
      traceState={traceState}
      activeCategory={activeCategory}
      currentQuery={currentQuery}
    />,
  );
}

function count(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

function anchorWithLabel(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const anchor = html.match(new RegExp(`<a[^>]*>${escaped}</a>`))?.[0];
  expect(anchor, `missing ${label} category link`).toBeDefined();
  return anchor ?? "";
}

function summaryValue(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = html.match(
    new RegExp(`<dt>${escaped}</dt><dd[^>]*>([^<]+)</dd>`),
  )?.[1];
  expect(value, `missing value for ${label} summary card`).toBeDefined();
  return value ?? "";
}

const summaryEvents: TraceEvent[] = [
  makeEvent({
    key: "payment:received",
    kind: "payment_received",
    category: "payments",
    tone: "payment",
    title: "Payment received",
    amountCents: 10_000,
    href: "/sales/sale-1",
  }),
  makeEvent({
    key: "payment:reversed",
    at: "2026-07-13T21:14:00.000Z",
    atLabel: "2026-07-14 01:14",
    kind: "payment_reversed",
    category: "payments",
    tone: "warning",
    status: "reversed",
    title: "Payment reversed",
    amountCents: -1_500,
    reason: "Entered twice",
    href: "/sales/sale-1",
  }),
  makeEvent({
    key: "audit:printed",
    at: "2026-07-13T21:13:00.000Z",
    kind: "receipt_printed",
    category: "receipts",
    tone: "receipt",
    title: "Receipt printed",
  }),
  makeEvent({
    key: "audit:skipped",
    at: "2026-07-13T21:12:00.000Z",
    kind: "receipt_skipped",
    category: "receipts",
    tone: "warning",
    status: "receipt_skipped",
    title: "Receipt skipped",
  }),
  makeEvent({
    key: "audit:emailed",
    at: "2026-07-13T21:11:00.000Z",
    kind: "receipt_emailed",
    category: "receipts",
    tone: "receipt",
    title: "Receipt emailed",
  }),
  makeEvent({
    key: "audit:sent",
    at: "2026-07-13T21:10:00.000Z",
    kind: "document_sent",
    category: "receipts",
    tone: "receipt",
    title: "Document sent",
  }),
  makeEvent({
    key: "session-close:variance",
    at: "2026-07-13T21:09:00.000Z",
    kind: "till_closed",
    category: "till",
    tone: "warning",
    status: "variance",
    title: "Till closed",
    amountCents: 250,
  }),
  makeEvent({
    key: "audit:disabled",
    at: "2026-07-13T21:08:00.000Z",
    kind: "device_disabled",
    tone: "warning",
    status: "disabled",
    title: "Device disabled",
  }),
];

describe("TraceabilityPanel", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T08:00:00.000Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("renders the approved structure and stable pre-filter summary totals", () => {
    const allHtml = renderPanel({ events: summaryEvents });
    const receiptsHtml = renderPanel({
      events: summaryEvents,
      activeCategory: "receipts",
    });

    for (const html of [allHtml, receiptsHtml]) {
      expect(summaryValue(html, "Events")).toBe("8");
      expect(summaryValue(html, "Net payments")).toBe("Rs 85.00");
      expect(summaryValue(html, "Receipts")).toBe("3");
      expect(summaryValue(html, "Exceptions")).toBe("4");
      expect(html).toContain("grid-cols-2");
      expect(html).toContain("sm:grid-cols-4");
    }

    expect(receiptsHtml).toContain("Document sent");
    expect(receiptsHtml).not.toContain("Payment received");

    const descriptionIndex = allHtml.indexOf(
      "Everything this device did in the selected period",
    );
    const summaryIndex = allHtml.indexOf("<dl");
    const filtersIndex = allHtml.indexOf(
      'aria-label="Traceability category filters"',
    );
    const feedIndex = allHtml.indexOf("<section");
    expect(descriptionIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(descriptionIndex);
    expect(filtersIndex).toBeGreaterThan(summaryIndex);
    expect(feedIndex).toBeGreaterThan(filtersIndex);
  });

  it("preserves scalar and repeated query values in every chip and removes traceCategory only for All", () => {
    const html = renderPanel({
      events: summaryEvents,
      activeCategory: "payments",
      currentQuery: {
        tab: "general",
        from: "2026-07-13",
        to: "2026-07-14",
        traceCategory: "payments",
        customer: ["vip one", "retail"],
        view: "compact",
      },
    });

    expect(html).toContain('aria-label="Traceability category filters"');
    expect(html).toContain("flex-wrap");

    const all = anchorWithLabel(html, "All");
    expect(all).toContain(
      'href="?tab=trace&amp;from=2026-07-13&amp;to=2026-07-14&amp;customer=vip+one&amp;customer=retail&amp;view=compact"',
    );
    expect(all).not.toContain("traceCategory");

    const expectedCategories = [
      ["Payments", "payments"],
      ["Till", "till"],
      ["Receipts", "receipts"],
      ["System", "system"],
      ["Exceptions", "exceptions"],
    ] as const;
    for (const [label, category] of expectedCategories) {
      const anchor = anchorWithLabel(html, label);
      expect(anchor).toContain("tab=trace");
      expect(anchor).toContain("from=2026-07-13");
      expect(anchor).toContain("to=2026-07-14");
      expect(anchor).toContain(`traceCategory=${category}`);
      expect(anchor).toContain("customer=vip+one");
      expect(anchor).toContain("customer=retail");
      expect(anchor).toContain("view=compact");
    }

    expect(anchorWithLabel(html, "Payments")).toContain(
      'aria-current="page"',
    );
    expect(anchorWithLabel(html, "All")).not.toContain("aria-current");
  });

  it("uses one full-card link for linked events and a non-interactive article for unlinked events", () => {
    const html = renderPanel({
      events: [
        makeEvent({
          key: "payment:linked",
          kind: "payment_received",
          category: "payments",
          tone: "payment",
          title: "Linked payment",
          href: "/sales/linked",
        }),
        makeEvent({ key: "audit:unlinked", title: "Unlinked event" }),
      ],
    });

    expect(count(html, /href="\/sales\/linked"/g)).toBe(1);
    expect(count(html, /<article\b/g)).toBe(1);
    expect(html).toMatch(
      /<a[^>]*href="\/sales\/linked"[^>]*class="[^"]*min-h-11[^"]*"[^>]*>[\s\S]*Linked payment[\s\S]*<\/a>/,
    );
    expect(html).toMatch(
      /<article[^>]*>[\s\S]*Unlinked event[\s\S]*<\/article>/,
    );
    expect(html).not.toContain("Chevron");
  });

  it("renders every approved visible exception status", () => {
    const html = renderPanel({ events: summaryEvents });

    expect(html).toContain("Reversed");
    expect(html).toContain("Receipt skipped");
    expect(html).toContain("Variance");
    expect(html).toContain("Disabled");
  });

  it("uses the approved Lucide kind mapping and decorative icons", () => {
    const iconCases = [
      ["terminal_started", "system", "system", "power"],
      ["version_changed", "system", "system", "download"],
      ["operator_signed_in", "system", "system", "user-round"],
      ["device_enabled", "system", "system", "power"],
      ["device_disabled", "system", "warning", "ban"],
      ["cash_out", "till", "till", "banknote"],
      ["receipt_printed", "receipts", "receipt", "receipt-text"],
      ["receipt_skipped", "receipts", "warning", "receipt-text"],
      ["receipt_emailed", "receipts", "receipt", "receipt-text"],
      ["document_sent", "receipts", "receipt", "receipt-text"],
      ["data_export", "system", "system", "file-down"],
      ["till_opened", "till", "till", "wallet"],
      ["till_closed", "till", "till", "calendar-check"],
      ["payment_received", "payments", "payment", "coins"],
      ["payment_reversed", "payments", "warning", "coins"],
      ["discount_applied", "payments", "payment", "badge-percent"],
      ["unexpected_event", "system", "system", "circle-dot"],
    ] as const;
    const toneClasses: Record<TraceEvent["tone"], string> = {
      payment: "bg-[rgba(13,167,124,0.12)] text-mint",
      till: "bg-[rgba(245,166,35,0.16)] text-amber-ink",
      receipt: "bg-[rgba(43,140,255,0.12)] text-link",
      system: "bg-[rgba(15,23,32,0.05)] text-faint",
      warning: "bg-[rgba(214,59,80,0.1)] text-rose",
    };

    for (const [kind, category, tone, icon] of iconCases) {
      const html = renderPanel({
        events: [
          makeEvent({
            key: `icon:${kind}`,
            kind,
            category,
            tone,
            status:
              kind === "device_disabled"
                ? "disabled"
                : kind === "receipt_skipped"
                  ? "receipt_skipped"
                  : kind === "payment_reversed"
                    ? "reversed"
                    : null,
            title: kind,
          }),
        ],
      });

      expect(html).toContain(`>${kind}</h4>`);
      expect(html).toMatch(
        new RegExp(
          `<svg(?=[^>]*class="lucide lucide-${icon}")(?=[^>]*aria-hidden="true")[^>]*>`,
        ),
      );
      expect(count(html, /<svg\b/g)).toBe(1);
      expect(html).toContain(toneClasses[tone]);
    }
  });

  it("renders Mauritius day groups, ordered lists, semantic times, and structured wrapping fields", () => {
    const html = renderPanel({
      events: [
        makeEvent({
          key: "payment:fields",
          kind: "payment_received",
          category: "payments",
          tone: "payment",
          title: "Payment received",
          summary: "Counter sale completed",
          actorName: "Anshika",
          amountCents: 12_345_678_900,
          method: "Card",
          reference: "INV-VERY-LONG-REFERENCE-0001",
          reason: "A long reason that must wrap safely on narrow screens",
          metadata: [
            { label: "Recipient", value: "very-long-address@example.com" },
            { label: "Expected cash", value: "Rs 100.00" },
            { label: "Whole sale", value: "5%" },
          ],
        }),
        makeEvent({
          key: "audit:previous-day",
          at: "2026-07-13T18:00:00.000Z",
          atLabel: "2026-07-13 22:00",
          title: "Previous day event",
        }),
      ],
    });

    expect(count(html, /<section\b/g)).toBe(2);
    expect(count(html, /<ol\b/g)).toBe(2);
    expect(count(html, /<li\b/g)).toBe(2);
    expect(html).toMatch(/<ol[^>]*>[\s\S]*<li/);
    expect(html).toContain("Today · 14 July");
    expect(html).toContain("Monday · 13 July");
    expect(html).toContain(
      '<time dateTime="2026-07-13T21:15:00.000Z"',
    );
    expect(html).toContain("<dt>Actor</dt>");
    expect(html).toContain("<dt>Method</dt>");
    expect(html).toContain("<dt>Reference</dt>");
    expect(html).toContain("<dt>Reason</dt>");
    expect(html).toContain("<dt>Recipient</dt>");
    expect(html).toMatch(
      /<dt>Expected cash<\/dt><dd class="num [^"]*">Rs 100.00<\/dd>/,
    );
    expect(html).toMatch(
      /<dt>Whole sale<\/dt><dd class="num [^"]*">5%<\/dd>/,
    );
    expect(html).toContain("break-words");
    expect(html).toContain("Rs 123,456,789.00");
    expect(html).toContain(
      "flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pl-12 sm:shrink-0 sm:flex-col sm:flex-nowrap sm:items-end sm:pl-0",
    );
    expect(html).not.toContain(
      "flex shrink-0 items-baseline justify-between gap-3 pl-12 sm:flex-col sm:items-end sm:pl-0",
    );
    expect(html).not.toContain("overflow-x-auto");
  });

  it("renders unavailable as an alert and suppresses every partial-data surface", () => {
    const html = renderPanel({
      events: summaryEvents,
      traceState: {
        ...READY,
        status: "unavailable",
        capped: true,
      },
      activeCategory: "payments",
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Audit trail unavailable");
    expect(html).toContain(
      "The audit trail could not be loaded. Refresh the page to retry.",
    );
    expect(html).not.toContain("Payment received");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain('aria-label="Traceability category filters"');
    expect(html).not.toContain("<section");
    expect(html).not.toContain("Based on the 150 events shown");
    expect(html).not.toContain(
      "Only the 150 most recent events in the selected period are loaded.",
    );
  });

  it("distinguishes empty-period, empty-filter, capped-empty, and capped-feed states", () => {
    const emptyPeriod = renderPanel();
    expect(emptyPeriod).toContain(
      "No events were recorded in the selected period.",
    );
    expect(emptyPeriod).not.toContain(
      "No events match the selected category.",
    );
    expect(emptyPeriod).toContain("<dt>Events</dt>");

    const payment = makeEvent({
      key: "payment:only",
      kind: "payment_received",
      category: "payments",
      tone: "payment",
      title: "Only payment",
      amountCents: 5_000,
    });
    const emptyFilter = renderPanel({
      events: [payment],
      activeCategory: "receipts",
    });
    expect(emptyFilter).toContain("No events match the selected category.");
    expect(emptyFilter).not.toContain(
      "No events were recorded in the selected period.",
    );

    const cappedState: TraceState = { ...READY, capped: true };
    const cappedEmpty = renderPanel({
      events: [payment],
      traceState: cappedState,
      activeCategory: "receipts",
    });
    expect(cappedEmpty).toContain("Based on the 150 events shown");
    expect(cappedEmpty).toContain(
      "No loaded events match this filter. Narrow the date range to search beyond the 150 events shown.",
    );
    expect(cappedEmpty).toContain(
      "Only the 150 most recent events in the selected period are loaded. Filters apply only to these loaded events. Narrow the date range to search further.",
    );

    const cappedFeed = renderPanel({
      events: [payment],
      traceState: cappedState,
      activeCategory: "payments",
    });
    const sectionIndex = cappedFeed.indexOf("<section");
    const footerIndex = cappedFeed.indexOf(
      "Only the 150 most recent events in the selected period are loaded.",
    );
    expect(sectionIndex).toBeGreaterThanOrEqual(0);
    expect(footerIndex).toBeGreaterThan(sectionIndex);
  });
});
