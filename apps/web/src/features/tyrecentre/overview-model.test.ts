import { describe, expect, it } from "vitest";
import {
  bayRows,
  collectedToday,
  companyIndex,
  onSiteLabel,
  periodSummary,
  salesByCompany,
  todayByCompany,
  topSellers,
  type OvCompany,
  type OvDoc,
  type OvJob,
} from "./overview-model";

const TYRES: OvCompany = { id: "co-tyres", name: "Tyre Centre Ltd", vatRegistered: true, isDefault: true };
const SERVICES: OvCompany = { id: "co-services", name: "Wheel Services Ltd", vatRegistered: false, isDefault: false };
const COS = [TYRES, SERVICES];

// Saturday 21 November 2026, 13:54 in Mauritius (UTC+4) = 09:54 UTC.
const NOW = Date.parse("2026-11-21T09:54:00Z");
const doc = (p: Partial<OvDoc>): OvDoc => ({ docType: "invoice", totalCents: 0, vatCents: 0, issuedAt: "2026-11-21T06:00:00Z", entityId: TYRES.id, ...p });

describe("companyIndex", () => {
  it("puts a row with no company on the default company (history from before companies)", () => {
    expect(companyIndex(null, COS)).toBe(0);
    expect(companyIndex(null, [SERVICES, TYRES])).toBe(1);
  });
  it("puts a retired company's row on the default company", () => {
    expect(companyIndex("gone", COS)).toBe(0);
  });
  it("finds the company by id", () => {
    expect(companyIndex(SERVICES.id, COS)).toBe(1);
  });
});

describe("salesByCompany + periodSummary", () => {
  const days = ["2026-11-19", "2026-11-20", "2026-11-21"];
  const docs = [
    doc({ totalCents: 11_500, vatCents: 1_500, issuedAt: "2026-11-20T08:00:00Z" }),
    doc({ totalCents: 2_300, vatCents: 300, issuedAt: "2026-11-21T05:00:00Z", entityId: null }), // old, no company
    doc({ totalCents: 1_300, issuedAt: "2026-11-21T06:00:00Z", entityId: SERVICES.id }),
    doc({ docType: "credit_note", totalCents: 300, issuedAt: "2026-11-21T07:00:00Z", entityId: SERVICES.id }),
    // 23:30 Mauritius on the 19th is 19:30 UTC — still the 19th, not the 20th.
    doc({ totalCents: 1_000, vatCents: 130, issuedAt: "2026-11-19T19:30:00Z" }),
    // 00:30 Mauritius on the 21st is 20:30 UTC on the 20th — it belongs to the 21st.
    doc({ totalCents: 500, issuedAt: "2026-11-20T20:30:00Z", entityId: SERVICES.id }),
  ];
  const s = salesByCompany(days, docs, COS);

  it("buckets per company per Mauritius day, credit notes against", () => {
    expect(s.perCompany[0]).toEqual([1_000, 11_500, 2_300]);
    expect(s.perCompany[1]).toEqual([0, 0, 1_300 - 300 + 500]);
  });
  it("counts the non-VAT company's VAT as nothing", () => {
    expect(s.vat).toEqual([130, 1_500, 300]);
  });
  it("sums a period and splits it by company", () => {
    const p = periodSummary(s, 2);
    expect(p.days).toEqual(["2026-11-20", "2026-11-21"]);
    expect(p.perCompanyCents).toEqual([13_800, 1_500]);
    expect(p.totalCents).toBe(15_300);
    expect(p.vatCents).toBe(1_800);
    expect(p.change).toBeNull(); // the series doesn't reach back two periods
  });
});

describe("todayByCompany", () => {
  it("compares with the same weekday last week up to the same time of day", () => {
    const docs = [
      doc({ totalCents: 10_000, issuedAt: "2026-11-21T05:00:00Z" }),
      doc({ totalCents: 8_000, issuedAt: "2026-11-14T05:00:00Z" }), // last Saturday, 09:00
      doc({ totalCents: 50_000, issuedAt: "2026-11-14T12:00:00Z" }), // last Saturday, 16:00 — later than now
      doc({ totalCents: 1_300, issuedAt: "2026-11-21T06:00:00Z", entityId: SERVICES.id }),
    ];
    const t = todayByCompany(docs, COS, NOW);
    expect(t[0]).toEqual({ cents: 10_000, invoices: 1, change: 0.25 });
    expect(t[1]).toEqual({ cents: 1_300, invoices: 1, change: null });
  });
});

describe("collectedToday", () => {
  it("nets a reversal against its day and drops a method that comes to nothing", () => {
    const c = collectedToday(
      [
        { method: "cash", cents: 5_000, at: "2026-11-21T05:00:00Z" },
        { method: "card", cents: 3_000, at: "2026-11-21T06:00:00Z" },
        { method: "card", cents: -3_000, at: "2026-11-21T07:00:00Z" },
        { method: "juice", cents: 2_000, at: "2026-11-21T07:00:00Z" },
        { method: "cash", cents: 9_999, at: "2026-11-20T05:00:00Z" }, // yesterday
      ],
      NOW,
    );
    expect(c.totalCents).toBe(7_000);
    expect(c.byMethod).toEqual([
      { method: "cash", cents: 5_000 },
      { method: "juice", cents: 2_000 },
    ]);
  });
});

describe("topSellers", () => {
  it("groups tyres by size whatever the brand, services by name, skips other parts", () => {
    const t = topSellers([
      { title: "Bridgestone Ecopia EP150 195/65R15 91H", qty: 4, cents: 13_570, kind: "product" },
      { title: "Michelin Primacy 4 195/65 R15 91V", qty: 2, cents: 9_200, kind: "product" },
      { title: "Michelin Primacy 4 205/55 R16", qty: 4, cents: 20_000, kind: "product" },
      { title: "Tubeless valve TR414", qty: 4, cents: 200, kind: "product" },
      { title: "Wheel alignment", qty: 1, cents: 1_300, kind: "service" },
      { title: "Wheel alignment", qty: 1, cents: 1_300, kind: "service" },
      { title: "Wheel balancing", qty: 4, cents: 680, kind: "service" },
    ]);
    expect(t.tyres).toEqual([
      { label: "195/65 R15", qty: 6, cents: 22_770 },
      { label: "205/55 R16", qty: 4, cents: 20_000 },
    ]);
    expect(t.services).toEqual([
      { label: "Wheel alignment", qty: 2, cents: 2_600 },
      { label: "Wheel balancing", qty: 4, cents: 680 },
    ]);
  });
});

describe("bayRows", () => {
  const job = (p: Partial<OvJob>): OvJob => ({
    id: "j",
    status: "in_progress",
    plate: "1234 AP 21",
    model: "Axio",
    work: "4 tyres + align",
    technician: "Kevin",
    createdAt: "2026-11-21T07:00:00Z",
    scheduledAt: null,
    startedAt: "2026-11-21T08:00:00Z",
    readyAt: null,
    deliveredAt: null,
    pausedAt: null,
    ...p,
  });

  it("says Ready to pay only while the job's bills are owed", () => {
    const bills = new Map([
      ["owed", { companies: [1, 0, 1], balanceCents: 1_380_000 }],
      ["paid", { companies: [1], balanceCents: 0 }],
    ]);
    const r = bayRows([job({ id: "paid", status: "ready" }), job({ id: "owed", status: "ready" })], bills, NOW);
    expect(r.onsite.map((x) => [x.id, x.status.label])).toEqual([
      ["owed", "Ready to pay"],
      ["paid", "Ready"],
    ]);
    expect(r.onsite[0].companies).toEqual([0, 1]);
    expect(r.onsite[0].stage).toBe(3);
  });

  it("shows a paused job red at its stage, with time on site", () => {
    const r = bayRows([job({ pausedAt: "2026-11-21T09:00:00Z" })], new Map(), NOW);
    expect(r.onsite[0]).toMatchObject({ stage: 2, blocked: true, status: { label: "Paused", tone: "danger" }, minutes: 114 });
    expect(r.onsite[0].detail).toBe("axio · 4 tyres + align");
  });

  it("books today's and overdue cars, leaves tomorrow's off, hands back today's only", () => {
    const r = bayRows(
      [
        job({ id: "today", status: "scheduled", startedAt: null, scheduledAt: "2026-11-21T10:30:00Z" }),
        job({ id: "tomorrow", status: "scheduled", startedAt: null, scheduledAt: "2026-11-22T06:00:00Z" }),
        job({ id: "done", status: "delivered", deliveredAt: "2026-11-21T09:00:00Z" }),
        job({ id: "old", status: "delivered", deliveredAt: "2026-11-19T09:00:00Z" }),
        job({ id: "gone", status: "cancelled" }),
      ],
      new Map(),
      NOW,
    );
    expect(r.booked.map((x) => [x.id, x.status.label, x.minutes])).toEqual([["today", "Booked 14:30", null]]);
    expect(r.handed.map((x) => [x.id, x.status.label, x.stage])).toEqual([["done", "Handed back 13:00", 4]]);
    expect(r.onsite).toEqual([]);
  });

  it("writes time on site the way the board does", () => {
    expect(onSiteLabel(38)).toBe("38 min");
    expect(onSiteLabel(65)).toBe("1 h 05");
    expect(onSiteLabel(1439)).toBe("23 h 59");
    expect(onSiteLabel(3 * 1440 + 70)).toBe("3 d");
  });
});
