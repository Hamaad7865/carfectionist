# Traceability Event Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse POS traceability rail with the approved owner-only, day-grouped audit-card experience while preserving complete financial/audit semantics and truthful failure states.

**Architecture:** Keep the Next.js page and Supabase reads server-side. Put trace contracts, normalization, mapping, filtering, summaries, grouping, and a repository-driven loader in one server-safe feature module; implement its Supabase repository in the existing POS query file. Render the approved layout through a server component, with the existing date control as the only small client boundary.

**Tech Stack:** Next.js 16.2 App Router, React 19 server/client components, TypeScript 5, Supabase/PostgREST, Tailwind CSS 4, Lucide React, Vitest 4, React DOM static rendering.

## Global Constraints

- Traceability is owner-only; managers retain General, Settings, and Cash Flow, and a direct manager `tab=trace` request resolves to General without a trace query.
- Do not add a service-role read, database migration, dependency, global design token, route, export, infinite scroll, or Activity-page change.
- Normalize every trace request to an inclusive Mauritius calendar-day range and query it as `[from 00:00+04, day-after-to 00:00+04)`.
- Primary streams are independently range-bounded, ordered by timestamp descending then stable ID descending, and limited to 151 candidates.
- Merge all mapped candidates by `(at DESC, key DESC)`, expose at most 150 events, and state visibly when the result is capped.
- Any required source or enrichment failure makes the entire trace unavailable; never present partial audit data as an empty or complete ledger.
- Reversal audit rows enrich their negative payment row and never render twice; discounts emit once per document.
- Keep one chronological column, semantic ordered lists, visible status text, one full-card link when supported, 44 px targets, and no page-level overflow at 320 px or 200% zoom.
- Reuse the current Manrope/Archivo typography, `.num`, existing CSS tokens, and Lucide icons; do not change `globals.css`.
- Follow test-driven development and commit after every independently passing task.

## File Structure

- Create `apps/web/src/features/pos/traceability.ts` — server-safe trace contracts, source-row contracts, pure mapping/helpers, and repository-driven loader.
- Create `apps/web/src/features/pos/traceability.test.ts` — range, mapping, sorting, cap, summary, filter, grouping, and URL tests.
- Create `apps/web/src/lib/supabase/queries/pos-devices.test.ts` — repository-orchestration and failure/pagination tests.
- Create `apps/web/src/features/pos/TraceabilityPanel.tsx` — server-rendered summary, filters, day groups, cards, and state notices.
- Create `apps/web/src/features/pos/TraceabilityPanel.test.tsx` — static-markup accessibility and visual-state tests.
- Create `apps/web/src/components/ui/DateRangeFilter.test.tsx` — normalized display and URL-update tests.
- Modify `apps/web/src/lib/supabase/queries/pos-devices.ts:233-695` — remove the flattened embedded trace builder, add a dedicated trace query/repository, and preserve General with cheap `lastActivity`.
- Modify `apps/web/src/components/ui/DateRangeFilter.tsx:1-44` — authoritative normalized display range, wrapping, and scroll-preserving replacements.
- Modify `apps/web/src/app/(app)/point-of-sale/[deviceId]/page.tsx:1-370` — owner-aware tab resolution, conditional trace loading, General `lastActivity`, and panel delegation.

---

### Task 1: Trace domain, range, filters, summaries, and grouping

**Files:**
- Create: `apps/web/src/features/pos/traceability.ts`
- Create: `apps/web/src/features/pos/traceability.test.ts`

**Interfaces:**
- Consumes: `muToday`, `muDateTime`, and `MU_OFFSET_MS` from `@/lib/mu-date`.
- Produces: `TraceEvent`, `TraceState`, `DeviceTraceabilityData`, `NormalizedTraceRange`, `TraceFilter`, `normalizeTraceRange`, `resolveTraceFilter`, `sortTraceEvents`, `selectNewestTraceEvents`, `filterTraceEvents`, `summarizeTraceEvents`, `groupTraceEventsByMauritiusDay`, and `buildTraceCategoryHref`.

- [ ] **Step 1: Write failing range and helper tests**

Add tests with fixed `NOW = Date.parse("2026-07-14T08:00:00.000Z")` covering missing, malformed, impossible, array, partial, reversed, leap-day, and valid ranges; exact Mauritius ISO boundaries; same-time key ordering; a 151-event cap; payment/receipt/exception summaries; category filtering; Mauritius midnight grouping; and preservation of repeated query parameters.

```ts
expect(normalizeTraceRange({}, NOW)).toEqual({
  from: "2026-07-14",
  to: "2026-07-14",
  startIso: "2026-07-13T20:00:00.000Z",
  endExclusiveIso: "2026-07-14T20:00:00.000Z",
});
expect(normalizeTraceRange({ from: "2026-02-30", to: "2026-07-10" }, NOW).from).toBe("2026-07-10");
expect(normalizeTraceRange({ from: "2026-07-14", to: "2026-07-12" }, NOW)).toMatchObject({ from: "2026-07-12", to: "2026-07-14" });
expect(resolveTraceFilter("unknown")).toBe("all");
expect(selectNewestTraceEvents(makeEvents(151))).toMatchObject({ capped: true });
expect(summarizeTraceEvents(events)).toEqual({
  events: events.length,
  netPaymentsCents: 8_500,
  receipts: 3,
  exceptions: 1,
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npm test --workspace web -- src/features/pos/traceability.test.ts
```

Expected: FAIL because `traceability.ts` and its exports do not exist.

- [ ] **Step 3: Implement the domain contracts and pure helpers**

Define these exact public contracts and constants:

```ts
export const TRACE_LIMIT = 150;
export const TRACE_SOURCE_LIMIT = TRACE_LIMIT + 1;
export type TraceCategory = "payments" | "till" | "receipts" | "system";
export type TraceTone = "payment" | "till" | "receipt" | "system" | "warning";
export type TraceStatus = "reversed" | "receipt_skipped" | "variance" | "disabled" | null;
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
```

Use regex plus UTC round-trip validation for exact real dates. Reject array values. Use a query copier that appends every repeated parameter, forces `tab=trace`, and removes `traceCategory` only for `all`. Summary rules are exact: net payments include only `payment_received` and `payment_reversed`; receipts include only `receipt_printed`, `receipt_skipped`, and `receipt_emailed`; exceptions are `status !== null`.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run the Task 1 command again.

Expected: PASS for all range/helper tests.

- [ ] **Step 5: Commit the domain layer**

```powershell
git add apps/web/src/features/pos/traceability.ts apps/web/src/features/pos/traceability.test.ts
git commit -m "feat(web): add traceability domain helpers"
```

---

### Task 2: Defensive event mapping

**Files:**
- Modify: `apps/web/src/features/pos/traceability.ts`
- Modify: `apps/web/src/features/pos/traceability.test.ts`

**Interfaces:**
- Consumes: Task 1 trace contracts and `rupeesToCents` from `@/lib/money`.
- Produces: typed audit/payment/session/discount source rows plus `mapAuditTraceEvent`, `mapPaymentTraceEvent`, `mapSessionOpenTraceEvent`, `mapSessionCloseTraceEvent`, and `mapDiscountTraceEvent`.

- [ ] **Step 1: Add table-driven failing mapper tests**

Use `it.each` for every normative source kind. Assert exact kind/category/tone/status, signed cents, actor, method, reference, reason, metadata, link, and stable key. Include unknown audit events, malformed payloads, `Number(null)` protection, suppressed `payment_reversed` and `period_closed` audits, a missing reversal match that yields `Reason unavailable`, and same-time split-tender canonical payment selection by `(received_at ASC, id ASC)`.

```ts
expect(mapAuditTraceEvent(periodClosed, context)).toBeNull();
expect(mapAuditTraceEvent(reversalAudit, context)).toBeNull();
expect(mapPaymentTraceEvent(negativePayment, context)).toMatchObject({
  key: "payment:payment-reversal",
  kind: "payment_reversed",
  tone: "warning",
  status: "reversed",
  amountCents: -2_500,
  reason: "Entered twice",
});
expect(discounts).toEqual([
  expect.objectContaining({ key: "discount:document-1", actorName: "Anshika" }),
]);
```

- [ ] **Step 2: Run the mapper test and confirm failure**

Run the Task 1 test command.

Expected: FAIL because mapper exports and source contracts are absent.

- [ ] **Step 3: Implement every mapper from the normative table**

Define source contracts before the mappers so query code never passes anonymous rows:

```ts
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
export interface TraceActorRow { id: string; display_name: string; }
export interface TraceSessionPaymentRow {
  id: string;
  cash_session_id: string | null;
  method: string;
  amount: number | string;
}
```

Use exact stable keys:

```ts
const auditKey = (id: string) => `audit:${id}`;
const paymentKey = (id: string) => `payment:${id}`;
const sessionOpenKey = (id: string) => `session-open:${id}`;
const sessionCloseKey = (id: string) => `session-close:${id}`;
const discountKey = (documentId: string) => `discount:${documentId}`;
```

Keep values in structured fields; `summary` must not repeat actor, amount, method, reference, reason, or metadata. Convert only finite non-null numerics. A cash-out is negative absolute cents. A till-close is exceptional only when signed variance is non-zero. Unknown audits humanize the event type and never expose raw JSON.

- [ ] **Step 4: Run the mapper test and confirm it passes**

Run the Task 1 test command again.

Expected: PASS for every normative mapping and suppression case.

- [ ] **Step 5: Commit the mapper layer**

```powershell
git add apps/web/src/features/pos/traceability.ts apps/web/src/features/pos/traceability.test.ts
git commit -m "feat(web): map structured trace events"
```

---

### Task 3: Trustworthy repository orchestration and Supabase reads

**Files:**
- Modify: `apps/web/src/features/pos/traceability.ts`
- Create: `apps/web/src/lib/supabase/queries/pos-devices.test.ts`
- Modify: `apps/web/src/lib/supabase/queries/pos-devices.ts:233-695`

**Interfaces:**
- Consumes: Task 2 row types/mappers, `fetchAllRowsByKeyset`, `createClient`, and existing POS cash/session types.
- Produces: `TraceRepository`, `loadDeviceTraceability`, `getDeviceTraceability`, and `DeviceDashboard.lastActivity`.

- [ ] **Step 1: Write failing repository-orchestration tests**

Define a fake repository with these methods and make each one independently return rows or throw:

```ts
interface TraceRepository {
  fetchAuditCandidates(code: string, range: NormalizedTraceRange): Promise<TraceAuditRow[]>;
  fetchPaymentCandidates(code: string, range: NormalizedTraceRange): Promise<TracePaymentRow[]>;
  fetchSessionOpenCandidates(code: string, range: NormalizedTraceRange): Promise<TraceSessionRow[]>;
  fetchSessionCloseCandidates(code: string, range: NormalizedTraceRange): Promise<TraceSessionRow[]>;
  fetchReversalAudits(originalIds: string[]): Promise<TraceReversalAuditRow[]>;
  fetchDiscountLines(documentIds: string[]): Promise<TraceDiscountLineRow[]>;
  fetchCanonicalPayments(code: string, documentIds: string[]): Promise<TracePaymentRow[]>;
  fetchActorNames(actorIds: string[]): Promise<TraceActorRow[]>;
  fetchClosingSessionPayments(sessionIds: string[]): Promise<TraceSessionPaymentRow[]>;
}
```

Cover every always-mandatory failure and every conditional failure when activated. Also assert conditional methods are not called for empty trigger sets, 101 actors use two 100-ID chunks, 1,001 enrichment rows cross a page, old ranges do not use a lifetime-session window, a close opened before `from` includes full-session payments, and a close outside the global 150 does not trigger close enrichment.

- [ ] **Step 2: Run orchestration tests and confirm failure**

```powershell
npm test --workspace web -- src/lib/supabase/queries/pos-devices.test.ts
```

Expected: FAIL because `TraceRepository`, `loadDeviceTraceability`, and `getDeviceTraceability` are not implemented.

- [ ] **Step 3: Implement `loadDeviceTraceability` against the repository seam**

Fetch the four mandatory streams concurrently. If any throws, return:

```ts
{
  trace: [],
  traceState: {
    status: "unavailable",
    capped: false,
    range: { from: range.from, to: range.to },
  },
}
```

Run reversal and discount enrichment only for candidate IDs. Collect actor IDs after reversal and canonical-payment rows exist. Split them into chunks of at most 100 and invoke `fetchActorNames` once per chunk; an empty actor set makes zero calls. Map, sort, and cap globally; then fetch complete payments only for till-close cards retained in the visible 150 and rebuild those cards with truthful non-cash totals. A successful missing reversal row remains ready and shows `Reason unavailable`.

- [ ] **Step 4: Replace the embedded trace builder with a Supabase repository**

Each primary query must inspect `{ error }`, use both stable orders, and use `TRACE_SOURCE_LIMIT`:

```ts
const audits = await sb
  .from("audit_events")
  .select("id, event_type, payload, created_at, actor_id, ref_id")
  .eq("device_id", code)
  .gte("created_at", range.startIso)
  .lt("created_at", range.endExclusiveIso)
  .not("event_type", "in", '(payment_reversed,period_closed)')
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(TRACE_SOURCE_LIMIT);
```

Payments must select `cash_sessions!inner(device_id)` and filter `cash_sessions.device_id = code`; openings use `(opened_at DESC, id DESC)`; closings use `(closed_at DESC, id DESC)`. Use `fetchAllRowsByKeyset` with fresh builders for document lines, canonical payments, and closing-session payments. Query exact actor IDs in chunks of 100 and throw on any chunk error. Never call `.in()` with an empty array.

- [ ] **Step 5: Split trace loading from the base dashboard**

Export:

```ts
export async function getDeviceTraceability(
  code: string,
  input: TraceRangeInput = {},
): Promise<DeviceTraceabilityData>;
```

At the start of this function, resolve the cached session context and return unavailable without issuing source reads when the role is not `owner`. The page gate remains the primary UX behavior; this defense prevents a future server caller from treating an RLS-hidden audit stream as complete.

Remove `DeviceDashboard.trace` and add:

```ts
export interface DeviceLastActivity {
  at: string;
  atLabel: string;
  title: string;
  summary: string | null;
}

lastActivity: DeviceLastActivity | null;
```

Compute `lastActivity` from one newest visible device audit plus the recent session/payment rows already used by the base dashboard. Do not run reversal, discount, actor-chunk, or closing-session enrichment for General.

- [ ] **Step 6: Run focused and full data tests**

```powershell
npm test --workspace web -- src/features/pos/traceability.test.ts src/lib/supabase/queries/pos-devices.test.ts
npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: both files PASS and TypeScript exits 0.

- [ ] **Step 7: Commit the query layer**

```powershell
git add apps/web/src/features/pos/traceability.ts apps/web/src/features/pos/traceability.test.ts apps/web/src/lib/supabase/queries/pos-devices.ts apps/web/src/lib/supabase/queries/pos-devices.test.ts
git commit -m "feat(web): load complete device trace data"
```

---

### Task 4: Normalized, composable date control

**Files:**
- Modify: `apps/web/src/components/ui/DateRangeFilter.tsx:1-44`
- Create: `apps/web/src/components/ui/DateRangeFilter.test.tsx`

**Interfaces:**
- Consumes: existing `next/navigation` hooks.
- Produces: backward-compatible `DateRangeFilter` with optional authoritative `displayRange`.

- [ ] **Step 1: Write failing normalized-display and URL tests**

Mock `usePathname`, `useRouter`, and `useSearchParams` using the existing sales-chart test pattern. Render malformed/reversed raw URL values with a valid display range. Invoke Clear/input handlers and assert `tab`, `traceCategory`, repeated unrelated parameters, and `{ scroll: false }` are preserved while only `from/to` change.

```tsx
const html = renderToStaticMarkup(
  <DateRangeFilter
    label={false}
    displayRange={{ from: "2026-07-12", to: "2026-07-14" }}
  />,
);
expect(html).toContain('value="2026-07-12"');
expect(html).toContain('value="2026-07-14"');
```

- [ ] **Step 2: Run the date-control test and confirm failure**

```powershell
npm test --workspace web -- src/components/ui/DateRangeFilter.test.tsx
```

Expected: FAIL because `displayRange` and scroll-preserving replacements are absent.

- [ ] **Step 3: Implement the backward-compatible control**

Use this prop contract:

```ts
export interface DateRangeFilterProps {
  label?: boolean;
  displayRange?: Readonly<{ from: string; to: string }>;
}
```

When supplied, `displayRange` is authoritative. Show Clear only when raw URL `from` or `to` exists. Add `role="group"`, `aria-label="Date range"`, `type="button"` on Clear, `aria-hidden` on the arrow, wrapping/min-width-safe classes, and `router.replace(href, { scroll: false })`.

- [ ] **Step 4: Run the date-control test and confirm it passes**

Run the Task 4 test command again.

Expected: PASS.

- [ ] **Step 5: Commit the date control**

```powershell
git add apps/web/src/components/ui/DateRangeFilter.tsx apps/web/src/components/ui/DateRangeFilter.test.tsx
git commit -m "feat(web): normalize trace date controls"
```

---

### Task 5: Grouped audit-card panel

**Files:**
- Create: `apps/web/src/features/pos/TraceabilityPanel.tsx`
- Create: `apps/web/src/features/pos/TraceabilityPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers/types, Task 4 `DateRangeFilter`, `formatMUR`, Next `Link`, and Lucide icons.
- Produces: `TraceabilityPanel(props)` as a server-renderable component.

- [ ] **Step 1: Write failing static-markup tests**

Mock `next/link` as a plain anchor and use `renderToStaticMarkup`. Assert the four summary cards and exact totals; summary stability across filters; `document_sent` filter inclusion but receipt-summary exclusion; chip URL preservation; one link per linked card and zero per unlinked card; every status label; `<section>/<ol>/<li>/<time datetime>`; active-chip `aria-current`; and distinct unavailable, empty-period, empty-filter, capped-empty, and cap-footer states.

```ts
expect(html).toContain("Net payments");
expect(html).toContain("Rs 85.00");
expect(html).toContain('aria-label="Traceability category filters"');
expect(html).toMatch(/<ol[^>]*>.*<li/s);
expect(html).toContain('<time datetime="2026-07-13T21:15:00.000Z"');
expect(unavailableHtml).not.toContain("Payment received");
```

- [ ] **Step 2: Run the panel test and confirm failure**

```powershell
npm test --workspace web -- src/features/pos/TraceabilityPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the approved panel structure**

Use this prop contract:

```ts
export interface TraceabilityPanelProps {
  events: readonly TraceEvent[];
  traceState: TraceState;
  activeCategory: TraceFilter;
  currentQuery: TraceQueryParams;
}
```

Implement, in order: description/date row, two-by-two/four-column summary `<dl>`, wrapping category `<nav>`, day-grouped ordered lists, and cap footer. Unavailable suppresses summary/filter/feed and uses `role="alert"`. Use exact state copy from the design specification.

Cards use one conditional wrapper:

```tsx
return event.href ? (
  <Link href={event.href} className={linkedCardClass}>{content}</Link>
) : (
  <article className={cardClass}>{content}</article>
);
```

Map real Lucide icons by kind. Use mint for payment, amber for till, blue for receipt, neutral for system, and rose for warning. Pair every warning tone with `Reversed`, `Receipt skipped`, `Variance`, or `Disabled`. Render actor, method, reference, reason, and metadata as structured `<dl>` fields with `break-words`; use `.num` for money/time. Keep amount/time visible and wrapping on narrow screens.

- [ ] **Step 4: Run the panel test and confirm it passes**

Run the Task 5 test command again.

Expected: PASS.

- [ ] **Step 5: Commit the panel**

```powershell
git add apps/web/src/features/pos/TraceabilityPanel.tsx apps/web/src/features/pos/TraceabilityPanel.test.tsx
git commit -m "feat(web): render grouped traceability cards"
```

---

### Task 6: Owner-aware page integration

**Files:**
- Modify: `apps/web/src/features/pos/traceability.ts`
- Modify: `apps/web/src/features/pos/traceability.test.ts`
- Modify: `apps/web/src/app/(app)/point-of-sale/[deviceId]/page.tsx:1-370`

**Interfaces:**
- Consumes: `getSessionContext`, `getDeviceDashboard`, `getDeviceTraceability`, `resolveTraceFilter`, and `TraceabilityPanel`.
- Produces: an owner-only Traceability tab that loads only on demand; all users keep the unchanged base device dashboard.

- [ ] **Step 1: Write failing tab-authorization tests**

Add pure helpers and tests for the page decision:

```ts
expect(resolveDeviceTab("owner", "trace")).toBe("trace");
expect(resolveDeviceTab("manager", "trace")).toBe("general");
expect(deviceTabsForRole("manager").map((tab) => tab.key)).not.toContain("trace");
expect(deviceTabsForRole("owner").map((tab) => tab.key)).toContain("trace");
```

- [ ] **Step 2: Run the helper test and confirm failure**

Run the Task 1 test command.

Expected: FAIL because role-aware tab helpers are absent.

- [ ] **Step 3: Implement role-aware tab helpers and page flow**

Keep `params` and `searchParams` as promises per Next.js 16.2. Normalize scalar values before passing base-dashboard options. Resolve the role/tab before any trace call:

```ts
const session = await getSessionContext();
const visibleTabs = deviceTabsForRole(session?.role ?? "manager");
const tab = resolveDeviceTab(session?.role ?? "manager", pick(sp.tab));
const data = await getDeviceDashboard(code, {
  ref: pick(sp.ref),
  from: pick(sp.from),
  to: pick(sp.to),
});
const traceData = tab === "trace"
  ? await getDeviceTraceability(code, { from: sp.from, to: sp.to })
  : null;
```

Use `lastActivity` in General. Remove the old icon map and inline trace rail. Render `TraceabilityPanel` only when `traceData` exists. Pass raw query parameters so filter links preserve scalar and repeated values.

- [ ] **Step 4: Run all focused trace tests**

```powershell
npm test --workspace web -- src/features/pos/traceability.test.ts src/lib/supabase/queries/pos-devices.test.ts src/components/ui/DateRangeFilter.test.tsx src/features/pos/TraceabilityPanel.test.tsx
npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit page integration**

```powershell
git add apps/web/src/features/pos/traceability.ts apps/web/src/features/pos/traceability.test.ts "apps/web/src/app/(app)/point-of-sale/[deviceId]/page.tsx"
git commit -m "feat(web): integrate owner traceability dashboard"
```

---

### Task 7: Full verification and visual comparison

**Files:**
- Verify only: every file changed in Tasks 1–6.

**Interfaces:**
- Consumes: the complete implementation.
- Produces: evidence that tests, lint, types, production build, responsive behavior, accessibility, and approved visual direction all pass.

- [ ] **Step 1: Run formatting and changed-file lint checks**

```powershell
git diff --check
npx eslint apps/web/src/features/pos/traceability.ts apps/web/src/features/pos/traceability.test.ts apps/web/src/features/pos/TraceabilityPanel.tsx apps/web/src/features/pos/TraceabilityPanel.test.tsx apps/web/src/components/ui/DateRangeFilter.tsx apps/web/src/components/ui/DateRangeFilter.test.tsx apps/web/src/lib/supabase/queries/pos-devices.ts apps/web/src/lib/supabase/queries/pos-devices.test.ts "apps/web/src/app/(app)/point-of-sale/[deviceId]/page.tsx"
```

Expected: both commands exit 0 with no diagnostics.

- [ ] **Step 2: Run the full automated suite and production build**

```powershell
npm test --workspace web
npx tsc --noEmit -p apps/web/tsconfig.json
npm run build --workspace web
```

Expected: all web tests PASS, TypeScript exits 0, and Next.js completes a production build.

- [ ] **Step 3: Start the isolated development server without copying secrets**

Run the following in the worktree shell. It loads the root workspace's ignored environment file into only the child shell process and never prints the values:

```powershell
$envFile = 'C:\Projects\Carfection\apps\web\.env.local'
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^([A-Z0-9_]+)=(.*)$') {
    $name = $matches[1]
    $value = $matches[2].Trim('"')
    Set-Item -Path "Env:$name" -Value $value
  }
}
npm run dev --workspace web
```

Expected: local Next.js responds successfully and no secret values appear in terminal output.

- [ ] **Step 4: Verify the authenticated owner flow in the user's Chrome**

Use the existing Chrome context. Check the actual Traceability route at desktop, tablet, and 320 px widths; 200% zoom; keyboard focus through date controls, category chips, and linked cards; unknown/All category URLs; Clear; a range with reversals/variance; and no document-level horizontal overflow.

Expected: all core controls work, chronological order stays clear, warning labels remain visible without color, and linked cards have one focus target.

- [ ] **Step 5: Perform the required combined visual comparison**

Capture the implemented owner Traceability screen at the same desktop viewport as the supplied Carfection reference. Place that capture together with the supplied current-Carfection and CashMag images in one comparison input. Inspect card radii, padding, typography, icon sizing, border strength, filter wrapping, summary alignment, warning emphasis, and right-edge overflow; fix any visible mismatch and repeat the comparison.

Expected: the result follows approved option A, uses Carfection's existing design language, and is visibly clearer than both source screens without inventing a different product style.

- [ ] **Step 6: Re-run affected verification after visual fixes**

Run Task 7 Steps 1–2 again.

Expected: every command remains green.

- [ ] **Step 7: Commit the verified final state**

```powershell
git add apps/web/src docs/superpowers/specs/2026-07-14-traceability-event-cards-design.md docs/superpowers/plans/2026-07-14-traceability-event-cards.md
git commit -m "feat(web): deliver traceability event cards"
```

Confirm the staged set contains only this feature before committing. Push `codex/traceability-event-cards` and open the GitHub handoff only after the commit succeeds.
