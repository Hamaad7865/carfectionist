# Sales Performance Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CashMag-style dashboard chart that plots net sales including VAT over time and reconciles the total line against stacked Counter/direct and Workshop-job bars.

**Architecture:** Keep all fiscal bucketing and net-sales calculations in a pure TypeScript module, fetch only the selected Mauritius-time range on the server, and pass a serializable result into a focused Recharts client component. Dashboard URL parameters control the period while the existing dashboard KPIs remain lifetime figures.

**Tech Stack:** Next.js 16 server components, React 19 client components, TypeScript 5, Supabase/PostgREST, Tailwind CSS 4, Recharts 3.8.x, Vitest 4.

## Global Constraints

- Use `documents.total_incl`; invoice values are positive and issued credit-note values are negative.
- Include invoices in `issued`, `partly_paid`, or `paid`; include credit notes only in `issued`; exclude quotes, drafts, and void documents.
- Attribute documents by `issued_at` in Mauritius time (UTC+04:00), never by `created_at`.
- Today uses 24 hourly buckets; multi-day ranges use inclusive daily buckets.
- Default to This month; support Today, Last 7 days, This month, and a custom range of at most 93 days.
- Plot valid negative net buckets below a visible zero baseline; never clamp them.
- Never turn a query failure into a successful zero-sales series.
- The line is `totalCents`; stacked bars are `counterCents` and `workshopCents`; every point must satisfy `totalCents = counterCents + workshopCents`.
- Preserve the existing dashboard access model and keep all existing KPI calculations unchanged.
- Use Carfection’s existing color, typography, card, money-formatting, and focus tokens.
- Do not change the Android app, add forecasts, add payment trends, add exports, or add device/category filters.

---

## File Structure

- Create `apps/web/src/features/dashboard/sales-performance.ts`: period normalization, Mauritius boundaries, zero-filled buckets, signed aggregation, labels, and chart data types.
- Create `apps/web/src/features/dashboard/sales-performance.test.ts`: pure financial/time-series behavior tests.
- Modify `apps/web/src/lib/supabase/queries/dashboard.ts`: range-limited paginated document query and explicit unavailable state.
- Create `apps/web/src/features/dashboard/SalesPeriodControls.tsx`: preset/custom controls backed by dashboard URL parameters.
- Create `apps/web/src/features/dashboard/SalesPerformanceChart.tsx`: accessible Recharts figure, tooltip, legend, empty/error states, and screen-reader table.
- Create `apps/web/src/features/dashboard/SalesPerformanceChart.test.tsx`: rendered accessibility, total, empty, and unavailable-state tests.
- Modify `apps/web/src/app/(app)/dashboard/page.tsx`: accept chart parameters, load the selected range, and place the chart after the KPI grid.
- Modify `apps/web/package.json` and `package-lock.json`: add `recharts` and React-matched `react-is`.
- Create `design-qa.md`: reference-versus-implementation browser QA gate.

---

### Task 1: Pure Mauritius Sales-Series Model

**Files:**
- Create: `apps/web/src/features/dashboard/sales-performance.ts`
- Create: `apps/web/src/features/dashboard/sales-performance.test.ts`

**Interfaces:**
- Consumes: `MU_OFFSET_MS` from `@/lib/mu-date` and `rupeesToCents` from `@/lib/money`.
- Produces:
  - `SalesPeriodInput`
  - `SalesRangeKey`
  - `SalesPeriod`
  - `SalesDocumentRow`
  - `SalesPoint`
  - `SalesPerformanceData`
  - `resolveSalesPeriod(input, nowMs)`
  - `buildSalesPerformance(period, rows)`
  - `unavailableSalesPerformance(period)`
  - `settleSalesPerformance(period, rowsPromise)`
  - `formatCompactMUR(cents)`

- [ ] **Step 1: Write the failing period tests**

Create `sales-performance.test.ts` with deterministic Mauritius time and these initial cases:

```ts
import { describe, expect, it } from "vitest";
import { resolveSalesPeriod } from "./sales-performance";

const NOW = Date.parse("2026-07-13T08:00:00.000Z"); // 12:00 in Mauritius

describe("resolveSalesPeriod", () => {
  it("defaults to the current Mauritius month through today", () => {
    expect(resolveSalesPeriod({}, NOW)).toMatchObject({
      range: "month",
      bucket: "day",
      from: "2026-07-01",
      to: "2026-07-13",
      startIso: "2026-06-30T20:00:00.000Z",
      endExclusiveIso: "2026-07-13T20:00:00.000Z",
      label: "1–13 July 2026",
    });
  });

  it("resolves Today to 24 Mauritius-hour buckets", () => {
    expect(resolveSalesPeriod({ salesRange: "today" }, NOW)).toMatchObject({
      range: "today",
      bucket: "hour",
      from: "2026-07-13",
      to: "2026-07-13",
    });
  });

  it("resolves Last 7 days inclusively", () => {
    expect(resolveSalesPeriod({ salesRange: "last7" }, NOW)).toMatchObject({
      range: "last7",
      from: "2026-07-07",
      to: "2026-07-13",
    });
  });

  it("accepts a valid custom range", () => {
    expect(resolveSalesPeriod({ salesRange: "custom", salesFrom: "2026-06-01", salesTo: "2026-06-30" }, NOW)).toMatchObject({
      range: "custom",
      from: "2026-06-01",
      to: "2026-06-30",
      label: "1–30 June 2026",
    });
  });

  it.each([
    { salesRange: "custom", salesFrom: "bad", salesTo: "2026-06-30" },
    { salesRange: "custom", salesFrom: "2026-07-02", salesTo: "2026-07-01" },
    { salesRange: "custom", salesFrom: "2026-01-01", salesTo: "2026-07-13" },
  ])("falls back to This month for invalid custom input %#", (input) => {
    expect(resolveSalesPeriod(input, NOW).range).toBe("month");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test --workspace web -- src/features/dashboard/sales-performance.test.ts
```

Expected: FAIL because `./sales-performance` does not exist.

- [ ] **Step 3: Add the period types and resolver**

Create `sales-performance.ts` with these public types and deterministic helpers:

```ts
import { rupeesToCents } from "@/lib/money";
import { MU_OFFSET_MS } from "@/lib/mu-date";

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 93;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type SalesRangeKey = "today" | "last7" | "month" | "custom";
export type SalesBucketKind = "hour" | "day";

export interface SalesPeriodInput {
  salesRange?: string;
  salesFrom?: string;
  salesTo?: string;
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

export interface SalesDocumentRow {
  id: string;
  doc_type: "invoice" | "credit_note";
  status: "draft" | "issued" | "partly_paid" | "paid" | "void";
  total_incl: number | string;
  origin: "standalone" | "from_job";
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
  status: "ready";
  period: SalesPeriod;
  points: SalesPoint[];
  totalCents: number;
  hasSales: boolean;
}

export interface UnavailableSalesPerformance {
  status: "unavailable";
  period: SalesPeriod;
  points: [];
  totalCents: null;
  hasSales: false;
}

export type SalesPerformanceData = ReadySalesPerformance | UnavailableSalesPerformance;

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
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function boundaryIso(date: string): string {
  return new Date(`${date}T00:00:00+04:00`).toISOString();
}

function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`);
  return { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), weekday: d.getUTCDay() };
}

function periodLabel(from: string, to: string): string {
  const a = dateParts(from);
  const b = dateParts(to);
  if (from === to) return `${a.day} ${MONTHS[a.month]} ${a.year}`;
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${MONTHS[a.month]} ${a.year}`;
  if (a.year === b.year) return `${a.day} ${MONTHS[a.month]}–${b.day} ${MONTHS[b.month]} ${a.year}`;
  return `${a.day} ${MONTHS[a.month]} ${a.year}–${b.day} ${MONTHS[b.month]} ${b.year}`;
}

function makePeriod(range: SalesRangeKey, bucket: SalesBucketKind, from: string, to: string): SalesPeriod {
  return { range, bucket, from, to, startIso: boundaryIso(from), endExclusiveIso: boundaryIso(addDays(to, 1)), label: periodLabel(from, to) };
}

export function resolveSalesPeriod(input: SalesPeriodInput = {}, nowMs = Date.now()): SalesPeriod {
  const today = new Date(nowMs + MU_OFFSET_MS).toISOString().slice(0, 10);
  if (input.salesRange === "today") return makePeriod("today", "hour", today, today);
  if (input.salesRange === "last7") return makePeriod("last7", "day", addDays(today, -6), today);
  if (input.salesRange === "custom" && isDate(input.salesFrom) && isDate(input.salesTo)) {
    const count = daysInclusive(input.salesFrom, input.salesTo);
    if (count >= 1 && count <= MAX_CUSTOM_DAYS) return makePeriod("custom", "day", input.salesFrom, input.salesTo);
  }
  return makePeriod("month", "day", `${today.slice(0, 7)}-01`, today);
}
```

- [ ] **Step 4: Run the focused test and verify the period tests pass**

Run the same focused command. Expected: the resolver tests pass while later aggregation imports/tests have not yet been added.

- [ ] **Step 5: Add failing aggregation and formatting tests**

Replace the `./sales-performance` import with the complete public contract, then append tests that use this row helper:

```ts
import {
  buildSalesPerformance,
  formatCompactMUR,
  resolveSalesPeriod,
  settleSalesPerformance,
  unavailableSalesPerformance,
  type SalesDocumentRow,
} from "./sales-performance";

function row(overrides: Partial<SalesDocumentRow> = {}): SalesDocumentRow {
  return {
    id: crypto.randomUUID(),
    doc_type: "invoice",
    status: "issued",
    total_incl: 100,
    origin: "standalone",
    issued_at: "2026-07-12T20:30:00.000Z", // 13 Jul 00:30 MU
    ...overrides,
  };
}

describe("buildSalesPerformance", () => {
  it("creates 24 zero-filled buckets for Today", () => {
    const data = buildSalesPerformance(resolveSalesPeriod({ salesRange: "today" }, NOW), []);
    expect(data.points).toHaveLength(24);
    expect(data.points[0]).toMatchObject({ key: "2026-07-13T00", axisLabel: "00:00", totalCents: 0 });
    expect(data.points[23]).toMatchObject({ key: "2026-07-13T23", axisLabel: "23:00", totalCents: 0 });
    expect(data.hasSales).toBe(false);
  });

  it("zero-fills an inclusive daily range", () => {
    const period = resolveSalesPeriod({ salesRange: "custom", salesFrom: "2026-07-10", salesTo: "2026-07-13" }, NOW);
    expect(buildSalesPerformance(period, []).points.map((point) => point.key)).toEqual([
      "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13",
    ]);
  });

  it("uses Mauritius midnight and separates origins", () => {
    const period = resolveSalesPeriod({ salesRange: "today" }, NOW);
    const data = buildSalesPerformance(period, [
      row(),
      row({ id: "job", origin: "from_job", total_incl: "250.50", issued_at: "2026-07-13T05:15:00.000Z" }),
    ]);
    expect(data.points[0]).toMatchObject({ counterCents: 10_000, workshopCents: 0, totalCents: 10_000 });
    expect(data.points[9]).toMatchObject({ counterCents: 0, workshopCents: 25_050, totalCents: 25_050 });
    expect(data.totalCents).toBe(35_050);
  });

  it("includes live invoice statuses and excludes draft and void rows", () => {
    const period = resolveSalesPeriod({ salesRange: "today" }, NOW);
    const rows = [
      row({ id: "issued", status: "issued" }),
      row({ id: "part", status: "partly_paid" }),
      row({ id: "paid", status: "paid" }),
      row({ id: "draft", status: "draft" }),
      row({ id: "void", status: "void" }),
    ];
    expect(buildSalesPerformance(period, rows).totalCents).toBe(30_000);
  });

  it("subtracts issued credit notes in their issue bucket and preserves a negative day", () => {
    const period = resolveSalesPeriod({ salesRange: "custom", salesFrom: "2026-07-12", salesTo: "2026-07-13" }, NOW);
    const data = buildSalesPerformance(period, [
      row({ id: "invoice", total_incl: 50, issued_at: "2026-07-12T10:00:00.000Z" }),
      row({ id: "credit", doc_type: "credit_note", status: "issued", total_incl: 75, issued_at: "2026-07-13T10:00:00.000Z" }),
      row({ id: "void-credit", doc_type: "credit_note", status: "void", total_incl: 20, issued_at: "2026-07-13T11:00:00.000Z" }),
    ]);
    expect(data.points.map((point) => point.totalCents)).toEqual([5_000, -7_500]);
    expect(data.totalCents).toBe(-2_500);
  });

  it("always reconciles the total line to both bar series", () => {
    const period = resolveSalesPeriod({ salesRange: "today" }, NOW);
    const data = buildSalesPerformance(period, [row(), row({ id: "job", origin: "from_job", total_incl: 40 })]);
    for (const point of data.points) expect(point.totalCents).toBe(point.counterCents + point.workshopCents);
  });
});

describe("presentation helpers", () => {
  it.each([
    [0, "Rs 0"], [99_900, "Rs 999"], [100_000, "Rs 1k"], [1_250_000, "Rs 12.5k"], [125_000_000, "Rs 1.25m"], [-5_000_000, "Rs -50k"],
  ])("formats %d cents as %s", (cents, expected) => expect(formatCompactMUR(cents)).toBe(expected));

  it("creates an explicit unavailable state", () => {
    expect(unavailableSalesPerformance(resolveSalesPeriod({}, NOW))).toMatchObject({ status: "unavailable", points: [], totalCents: null, hasSales: false });
  });

  it("turns a rejected sales query into an unavailable state rather than zero sales", async () => {
    const period = resolveSalesPeriod({}, NOW);
    await expect(settleSalesPerformance(period, Promise.reject(new Error("database unavailable")))).resolves.toMatchObject({
      status: "unavailable",
      totalCents: null,
      points: [],
    });
  });
});
```

- [ ] **Step 6: Run the focused test and verify RED**

Expected: FAIL because the aggregation and presentation exports are missing.

- [ ] **Step 7: Implement zero-filled signed aggregation and compact money formatting**

Complete `sales-performance.ts` with:

```ts
function fullDayLabel(date: string): string {
  const value = dateParts(date);
  return `${WEEKDAYS[value.weekday]} ${value.day} ${MONTHS[value.month]} ${value.year}`;
}

function liveCents(row: SalesDocumentRow): number | null {
  const liveInvoice = row.doc_type === "invoice" && ["issued", "partly_paid", "paid"].includes(row.status);
  const liveCredit = row.doc_type === "credit_note" && row.status === "issued";
  if ((!liveInvoice && !liveCredit) || !row.issued_at) return null;
  const amount = Number(row.total_incl);
  if (!Number.isFinite(amount)) return null;
  const cents = rupeesToCents(amount);
  return liveCredit ? -cents : cents;
}

function emptyPoints(period: SalesPeriod): SalesPoint[] {
  if (period.bucket === "hour") {
    return Array.from({ length: 24 }, (_, hour) => {
      const hh = String(hour).padStart(2, "0");
      return { key: `${period.from}T${hh}`, axisLabel: `${hh}:00`, fullLabel: `${fullDayLabel(period.from)}, ${hh}:00`, counterCents: 0, workshopCents: 0, totalCents: 0 };
    });
  }
  return Array.from({ length: daysInclusive(period.from, period.to) }, (_, index) => {
    const date = addDays(period.from, index);
    const parts = dateParts(date);
    return { key: date, axisLabel: `${WEEKDAYS[parts.weekday].slice(0, 3)} ${String(parts.day).padStart(2, "0")}`, fullLabel: fullDayLabel(date), counterCents: 0, workshopCents: 0, totalCents: 0 };
  });
}

export function buildSalesPerformance(period: SalesPeriod, rows: SalesDocumentRow[]): ReadySalesPerformance {
  const points = emptyPoints(period);
  const byKey = new Map(points.map((point) => [point.key, point]));
  for (const row of rows) {
    const cents = liveCents(row);
    if (cents === null || !row.issued_at) continue;
    const local = new Date(Date.parse(row.issued_at) + MU_OFFSET_MS).toISOString();
    const key = period.bucket === "hour" ? local.slice(0, 13) : local.slice(0, 10);
    const point = byKey.get(key);
    if (!point) continue;
    if (row.origin === "from_job") point.workshopCents += cents;
    else point.counterCents += cents;
    point.totalCents = point.counterCents + point.workshopCents;
  }
  return {
    status: "ready",
    period,
    points,
    totalCents: points.reduce((sum, point) => sum + point.totalCents, 0),
    hasSales: points.some((point) => point.counterCents !== 0 || point.workshopCents !== 0),
  };
}

export function unavailableSalesPerformance(period: SalesPeriod): UnavailableSalesPerformance {
  return { status: "unavailable", period, points: [], totalCents: null, hasSales: false };
}

export async function settleSalesPerformance(period: SalesPeriod, rowsPromise: Promise<SalesDocumentRow[]>): Promise<SalesPerformanceData> {
  try {
    return buildSalesPerformance(period, await rowsPromise);
  } catch {
    return unavailableSalesPerformance(period);
  }
}

export function formatCompactMUR(cents: number): string {
  const rupees = Math.trunc(cents) / 100;
  const abs = Math.abs(rupees);
  const compact = (divisor: number, suffix: string) => `${Number((rupees / divisor).toFixed(2))}${suffix}`;
  if (abs >= 1_000_000) return `Rs ${compact(1_000_000, "m")}`;
  if (abs >= 1_000) return `Rs ${compact(1_000, "k")}`;
  return `Rs ${Math.trunc(rupees)}`;
}
```

- [ ] **Step 8: Run focused and full web tests**

Run:

```powershell
npm test --workspace web -- src/features/dashboard/sales-performance.test.ts
npm test --workspace web
```

Expected: focused tests pass; the full existing suite remains green.

- [ ] **Step 9: Commit Task 1**

```powershell
git add apps/web/src/features/dashboard/sales-performance.ts apps/web/src/features/dashboard/sales-performance.test.ts
git commit -m "feat(dashboard): model Mauritius sales performance"
```

---

### Task 2: Range-Limited Dashboard Query

**Files:**
- Modify: `apps/web/src/features/dashboard/sales-performance.ts`
- Modify: `apps/web/src/features/dashboard/sales-performance.test.ts`
- Modify: `apps/web/src/lib/supabase/queries/dashboard.ts`

**Interfaces:**
- Consumes: `SalesPeriodInput`, `SalesDocumentRow`, `resolveSalesPeriod`, `settleSalesPerformance`, and `fetchAllRows`.
- Produces: `SalesQuerySpec`, `salesQuerySpec(period)`, `DashboardData.salesPerformance: SalesPerformanceData`, and `getDashboard(input?: SalesPeriodInput)`.

- [ ] **Step 1: Write a failing query-specification test**

Extend the `./sales-performance` import with `salesQuerySpec`, then add one PostgREST row case and one exact fiscal-query specification case:

```ts
it("accepts PostgREST numeric strings and ignores rows outside the selected buckets", () => {
  const period = resolveSalesPeriod({ salesRange: "today" }, NOW);
  const data = buildSalesPerformance(period, [
    row({ total_incl: "123.45" }),
    row({ id: "outside", total_incl: "999", issued_at: "2026-07-11T10:00:00.000Z" }),
  ]);
  expect(data.totalCents).toBe(12_345);
});

it("describes the exact paginated fiscal query window", () => {
  const period = resolveSalesPeriod({ salesRange: "today" }, NOW);
  expect(salesQuerySpec(period)).toEqual({
    columns: "id, doc_type, status, total_incl, origin, issued_at",
    docTypes: ["invoice", "credit_note"],
    statuses: ["issued", "partly_paid", "paid"],
    startIso: "2026-07-12T20:00:00.000Z",
    endExclusiveIso: "2026-07-13T20:00:00.000Z",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Expected: the PostgREST numeric-string case passes, while the query-specification case fails because `salesQuerySpec` does not exist.

- [ ] **Step 3: Add the paginated query and explicit failure state**

In `dashboard.ts`:

```ts
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  resolveSalesPeriod,
  salesQuerySpec,
  settleSalesPerformance,
  type SalesDocumentRow,
  type SalesPerformanceData,
  type SalesPeriodInput,
} from "@/features/dashboard/sales-performance";
```

Add `salesPerformance: SalesPerformanceData` to `DashboardData`, accept `input`, resolve the period once, and add this promise beside the existing dashboard reads:

```ts
export async function getDashboard(input: SalesPeriodInput = {}): Promise<DashboardData> {
  const sb = await createClient();
  const period = resolveSalesPeriod(input);
  const salesQuery = salesQuerySpec(period);
  const salesPerformancePromise = settleSalesPerformance(period, fetchAllRows<SalesDocumentRow>(
    () => sb
      .from("documents")
      .select(salesQuery.columns)
      .in("doc_type", salesQuery.docTypes)
      .in("status", salesQuery.statuses)
      .not("issued_at", "is", null)
      .gte("issued_at", salesQuery.startIso)
      .lt("issued_at", salesQuery.endExclusiveIso),
    "id",
  ));
```

Add this pure specification beside the other exports in `sales-performance.ts` before wiring the server query:

```ts
export interface SalesQuerySpec {
  columns: "id, doc_type, status, total_incl, origin, issued_at";
  docTypes: ["invoice", "credit_note"];
  statuses: ["issued", "partly_paid", "paid"];
  startIso: string;
  endExclusiveIso: string;
}

export function salesQuerySpec(period: SalesPeriod): SalesQuerySpec {
  return {
    columns: "id, doc_type, status, total_incl, origin, issued_at",
    docTypes: ["invoice", "credit_note"],
    statuses: ["issued", "partly_paid", "paid"],
    startIso: period.startIso,
    endExclusiveIso: period.endExclusiveIso,
  };
}
```

Include `salesPerformancePromise` in the existing `Promise.all`, bind the result as `salesPerformance`, and return it without modifying any other totals.

The extended tuple is:

```ts
const [invoices, payments, services, stocked, locations, team, recent, lines, salesPerformance] = await Promise.all([
  sb.from("documents").select("total_incl, amount_paid").eq("doc_type", "invoice").in("status", ["issued", "partly_paid", "paid"]),
  sb.from("payments").select("method, amount"),
  sb.from("products").select("id", { count: "exact", head: true }).eq("kind", "service"),
  sb.from("products").select("id", { count: "exact", head: true }).eq("is_stocked", true),
  sb.from("stock_locations").select("id", { count: "exact", head: true }),
  sb.from("app_users").select("id", { count: "exact", head: true }).eq("is_active", true),
  sb.from("documents").select("id, doc_type, number, status, total_incl, created_at, customers(name)").order("created_at", { ascending: false }).limit(6),
  sb.from("document_lines").select("title, line_total_excl, qty, documents!inner(status)").eq("documents.status", "paid"),
  salesPerformancePromise,
]);
```

Add `salesPerformance` to the returned `DashboardData` object immediately after `docCount`.

- [ ] **Step 4: Run type checking and the full web tests**

```powershell
npx tsc --noEmit -p apps/web/tsconfig.json
npm test --workspace web
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/web/src/lib/supabase/queries/dashboard.ts apps/web/src/features/dashboard/sales-performance.test.ts
git commit -m "feat(dashboard): load net sales series"
```

---

### Task 3: CashMag-Style Chart and Period Controls

**Files:**
- Create: `apps/web/src/features/dashboard/SalesPeriodControls.tsx`
- Create: `apps/web/src/features/dashboard/SalesPerformanceChart.tsx`
- Create: `apps/web/src/features/dashboard/SalesPerformanceChart.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `SalesPeriod`, `SalesPerformanceData`, `formatCompactMUR`, and existing `formatMUR`.
- Produces: `SalesPeriodControls({ period })` and `SalesPerformanceChart({ data })`.

- [ ] **Step 1: Install the chart dependencies**

Use the current stable Recharts 3.8 line and match `react-is` exactly to the workspace’s React version:

```powershell
npm install recharts@^3.8.1 react-is@19.2.4 --workspace web
```

Expected: `apps/web/package.json` and the root `package-lock.json` update without changing React itself.

- [ ] **Step 2: Write failing rendered chart tests**

Create `SalesPerformanceChart.test.tsx`. Mock only Next’s navigation context; render the real chart component and its accessible fallback with React DOM:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SalesPerformanceChart } from "./SalesPerformanceChart";
import { buildSalesPerformance, resolveSalesPeriod, unavailableSalesPerformance, type SalesDocumentRow } from "./sales-performance";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = Date.parse("2026-07-13T08:00:00.000Z");
const period = resolveSalesPeriod({ salesRange: "today" }, NOW);
const invoice: SalesDocumentRow = {
  id: "invoice",
  doc_type: "invoice",
  status: "issued",
  total_incl: 123.45,
  origin: "standalone",
  issued_at: "2026-07-12T20:30:00.000Z",
};

describe("SalesPerformanceChart", () => {
  it("renders the period total and an accessible table with exact MUR values", () => {
    const html = renderToStaticMarkup(<SalesPerformanceChart data={buildSalesPerformance(period, [invoice])} />);
    expect(html).toContain("Sales performance");
    expect(html).toContain("Total incl. VAT");
    expect(html).toContain("Rs 123.45");
    expect(html).toContain("Sales including VAT by period and sales mode");
    expect(html).toContain("Counter or direct");
  });

  it("renders zero buckets with an honest empty message", () => {
    const html = renderToStaticMarkup(<SalesPerformanceChart data={buildSalesPerformance(period, [])} />);
    expect(html).toContain("No issued sales in this period.");
    expect(html).toContain("Rs 0.00");
  });

  it("renders query failure as unavailable rather than zero sales", () => {
    const html = renderToStaticMarkup(<SalesPerformanceChart data={unavailableSalesPerformance(period)} />);
    expect(html).toContain("Sales chart unavailable");
    expect(html).not.toContain("No issued sales in this period.");
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Expected: FAIL because `SalesPerformanceChart.tsx` does not exist.

- [ ] **Step 4: Implement URL-backed period controls**

Create `SalesPeriodControls.tsx` as a client component. Preserve unrelated search parameters, use `router.replace`, set `salesRange`, and remove custom dates when choosing a preset:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SalesPeriod, SalesRangeKey } from "./sales-performance";

const PRESETS: { key: Exclude<SalesRangeKey, "custom">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "last7", label: "7 days" },
  { key: "month", label: "This month" },
];

export function SalesPeriodControls({ period }: { period: SalesPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function replace(update: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(update)) value ? next.set(key, value) : next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function choosePreset(key: Exclude<SalesRangeKey, "custom">) {
    replace({ salesRange: key, salesFrom: null, salesTo: null });
  }

  function chooseDate(key: "salesFrom" | "salesTo", value: string) {
    replace({ salesRange: "custom", salesFrom: key === "salesFrom" ? value : period.from, salesTo: key === "salesTo" ? value : period.to });
  }

  const inputClass = "h-8 rounded-[9px] border border-line-2 bg-card px-2 text-[11.5px] font-semibold text-body [color-scheme:light]";

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Sales chart period">
      {PRESETS.map((preset) => (
        <button key={preset.key} type="button" aria-pressed={period.range === preset.key} onClick={() => choosePreset(preset.key)} className={`h-8 rounded-[9px] px-2.5 text-[11.5px] font-bold ${period.range === preset.key ? "bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"}`}>
          {preset.label}
        </button>
      ))}
      <input type="date" aria-label="Sales chart from date" value={period.from} max={period.to} onChange={(event) => chooseDate("salesFrom", event.target.value)} className={inputClass} />
      <span className="text-[11px] text-faint">to</span>
      <input type="date" aria-label="Sales chart to date" value={period.to} min={period.from} onChange={(event) => chooseDate("salesTo", event.target.value)} className={inputClass} />
    </div>
  );
}
```

- [ ] **Step 5: Implement the accessible composed chart**

Create `SalesPerformanceChart.tsx` as a client component with these required behaviors:

```tsx
"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMUR } from "@/lib/money";
import { formatCompactMUR, type SalesPerformanceData, type SalesPoint } from "./sales-performance";
import { SalesPeriodControls } from "./SalesPeriodControls";

type TooltipEntry = { payload?: SalesPoint };

function SalesTooltip({ active, payload }: { active?: boolean; payload?: readonly TooltipEntry[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="min-w-[210px] rounded-[12px] border border-line-2 bg-card p-3 shadow-xl">
      <div className="mb-2 text-[11.5px] font-bold text-ink">{point.fullLabel}</div>
      {[
        ["Counter / direct", point.counterCents, "#2b8cff"],
        ["Workshop jobs", point.workshopCents, "#6a5cff"],
        ["Total incl. VAT", point.totalCents, "#1e6fe0"],
      ].map(([label, cents, color]) => (
        <div key={String(label)} className="flex items-center gap-2 py-1 text-[11.5px]">
          <span className="size-2 rounded-sm" style={{ background: String(color) }} />
          <span className="flex-1 text-muted">{label}</span>
          <span className="num font-bold text-ink">{formatMUR(Number(cents))}</span>
        </div>
      ))}
    </div>
  );
}

export function SalesPerformanceChart({ data }: { data: SalesPerformanceData }) {
  const minPlotWidth = data.status === "ready" ? Math.max(720, data.points.length * 38) : 720;
  return (
    <figure className="rounded-[15px] border border-line bg-card p-4 sm:p-5" aria-labelledby="sales-performance-title">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <figcaption>
          <div id="sales-performance-title" className="font-display text-[15px] font-extrabold text-ink">Sales performance</div>
          <div className="mt-0.5 text-[11.5px] text-muted">Net sales including VAT · {data.period.label}</div>
        </figcaption>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="num text-[18px] font-extrabold text-ink-strong">{data.status === "ready" ? formatMUR(data.totalCents) : "—"}</div>
          <SalesPeriodControls period={data.period} />
        </div>
      </div>

      {data.status === "unavailable" ? (
        <div className="mt-5 rounded-[12px] bg-sub px-4 py-12 text-center">
          <div className="text-[13px] font-bold text-body">Sales chart unavailable</div>
          <div className="mt-1 text-[11.5px] text-muted">Refresh the page to retry loading this period.</div>
        </div>
      ) : (
        <>
          {!data.hasSales && <div className="mt-4 text-center text-[11.5px] text-faint">No issued sales in this period.</div>}
          <div className="mt-3 overflow-x-auto pb-1">
            <div style={{ width: `max(100%, ${minPlotWidth}px)`, height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.points} accessibilityLayer margin={{ top: 12, right: 18, bottom: 48, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgba(15,23,32,0.08)" strokeDasharray="3 4" />
                  <XAxis dataKey="axisLabel" interval={0} angle={-35} textAnchor="end" height={64} tick={{ fill: "#68737f", fontSize: 10 }} axisLine={{ stroke: "rgba(15,23,32,0.12)" }} tickLine={false} />
                  <YAxis tickFormatter={formatCompactMUR} width={76} tick={{ fill: "#68737f", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SalesTooltip />} cursor={{ fill: "rgba(43,140,255,0.05)" }} />
                  <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="rgba(15,23,32,0.26)" />
                  <Bar dataKey="counterCents" name="Counter / direct" stackId="sales" fill="#2b8cff" maxBarSize={28} isAnimationActive={false} />
                  <Bar dataKey="workshopCents" name="Workshop jobs" stackId="sales" fill="#6a5cff" maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Line dataKey="totalCents" name="Total incl. VAT" type="monotone" stroke="#1e6fe0" strokeWidth={2.25} dot={false} activeDot={{ r: 4, fill: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <table className="sr-only">
            <caption>Sales including VAT by period and sales mode</caption>
            <thead><tr><th>Period</th><th>Counter or direct</th><th>Workshop jobs</th><th>Total including VAT</th></tr></thead>
            <tbody>{data.points.map((point) => <tr key={point.key}><th>{point.fullLabel}</th><td>{formatMUR(point.counterCents)}</td><td>{formatMUR(point.workshopCents)}</td><td>{formatMUR(point.totalCents)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </figure>
  );
}
```

- [ ] **Step 6: Run the focused test, changed-file lint, and type checking**

```powershell
npm test --workspace web -- src/features/dashboard/sales-performance.test.ts
npm test --workspace web -- src/features/dashboard/SalesPerformanceChart.test.tsx
npx eslint apps/web/src/features/dashboard/sales-performance.ts apps/web/src/features/dashboard/sales-performance.test.ts apps/web/src/features/dashboard/SalesPeriodControls.tsx apps/web/src/features/dashboard/SalesPerformanceChart.tsx apps/web/src/features/dashboard/SalesPerformanceChart.test.tsx
npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: all commands exit 0 with no changed-file lint errors.

- [ ] **Step 7: Commit Task 3**

```powershell
git add apps/web/package.json package-lock.json apps/web/src/features/dashboard/SalesPeriodControls.tsx apps/web/src/features/dashboard/SalesPerformanceChart.tsx apps/web/src/features/dashboard/SalesPerformanceChart.test.tsx
git commit -m "feat(dashboard): render CashMag-style sales chart"
```

---

### Task 4: Dashboard Integration and Visual Verification

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Create: `design-qa.md`

**Interfaces:**
- Consumes: `getDashboard(SalesPeriodInput)` and `SalesPerformanceChart({ data })`.
- Produces: the complete `/dashboard?salesRange=...` experience.

- [ ] **Step 1: Pass dashboard URL parameters into the query and render the chart**

Update the page signature and imports:

```tsx
import { SalesPerformanceChart } from "@/features/dashboard/SalesPerformanceChart";
import type { SalesPeriodInput } from "@/features/dashboard/sales-performance";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SalesPeriodInput> }) {
  const params = await searchParams;
  const [d, session] = await Promise.all([getDashboard(params), getSessionContext()]);
```

Insert this exact component between the KPI grid and the payment-method/catalogue row:

```tsx
<SalesPerformanceChart data={d.salesPerformance} />
```

- [ ] **Step 2: Run automated verification**

```powershell
npm test --workspace web
npx tsc --noEmit -p apps/web/tsconfig.json
npx eslint apps/web/src/features/dashboard/sales-performance.ts apps/web/src/features/dashboard/sales-performance.test.ts apps/web/src/features/dashboard/SalesPeriodControls.tsx apps/web/src/features/dashboard/SalesPerformanceChart.tsx apps/web/src/features/dashboard/SalesPerformanceChart.test.tsx "apps/web/src/app/(app)/dashboard/page.tsx" apps/web/src/lib/supabase/queries/dashboard.ts
npm run build --workspace web
```

Expected: all feature tests and changed-file lint pass, TypeScript exits 0, and the Next production build exits 0.

- [ ] **Step 3: Run the app and inspect the real dashboard**

Start the web app:

```powershell
npm run dev --workspace web
```

Use the in-app browser with the existing signed-in session if available. Inspect:

- `/dashboard?salesRange=today` at 1280px and 320px;
- `/dashboard?salesRange=last7` at 768px;
- `/dashboard?salesRange=month` at 1280px and 320px;
- a custom date range;
- a tooltip/keyboard focus state;
- horizontal scrolling on narrow widths;
- zero and negative baselines if the available data exposes them.

- [ ] **Step 4: Complete the blocking design QA gate**

Create `design-qa.md` in the project root. Compare the supplied CashMag screenshot and the local dashboard capture at equivalent desktop density. Record:

```md
# Sales Performance Chart Design QA

## Reference behavior
- Money on the Y-axis
- Time on the X-axis
- Filled sales-mode bars
- Total-including-tax line
- Legend and hover detail

## Local checks
- [ ] Series meaning matches the reference
- [ ] Total line reconciles to stacked modes
- [ ] Axis labels remain readable
- [ ] Tooltip uses exact MUR amounts
- [ ] Empty and error states do not fabricate sales
- [ ] Mobile chart remains usable through horizontal scroll
- [ ] Keyboard and screen-reader equivalents are present

## Findings
- P0: none
- P1: none
- P2: none
- P3: list polish-only follow-ups, or `none`

final result: passed
```

Fix every P0/P1/P2, capture again, and repeat the comparison until the file ends with `final result: passed`. If authenticated browser inspection is impossible, write the blocker and set `final result: blocked`; do not claim visual completion.

- [ ] **Step 5: Re-run fresh final verification after visual fixes**

Run the full Task 4 automated command block again. Also run:

```powershell
git diff --check
git status --short
```

Expected: automated verification succeeds, `design-qa.md` says `final result: passed`, and Git shows only intended feature files.

- [ ] **Step 6: Commit Task 4**

```powershell
git add "apps/web/src/app/(app)/dashboard/page.tsx" design-qa.md
git commit -m "feat(dashboard): add sales performance view"
```

---

## Final Review Checklist

- [ ] Each implementation task followed a witnessed RED → GREEN cycle.
- [ ] Every acceptance criterion in the approved design maps to a passing test or browser check.
- [ ] No chart value uses payment data, `created_at`, or `issue_date`.
- [ ] Credit notes, negative buckets, Mauritius boundaries, origins, zero filling, and query failure are covered.
- [ ] The dependency lockfile contains Recharts and React-19-matched `react-is` without changing the React version.
- [ ] Full web tests, TypeScript, changed-file lint, and the production build pass from fresh runs.
- [ ] `design-qa.md` ends in `final result: passed`.
- [ ] No unrelated user files or pre-existing changes are included in feature commits.
