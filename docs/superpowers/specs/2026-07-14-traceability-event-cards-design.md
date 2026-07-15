# Traceability Event Cards — Design Specification

Date: 2026-07-14
Status: Approved visual direction; pending written-spec review
Selected concept: A — Grouped audit cards

## Purpose

Replace the sparse CashMag-style traceability rail with a clearer Carfection audit experience. The redesign must keep every event in chronological order while making amounts, operators, document references, device details, and exceptions scannable without reading flattened dot-separated prose.

The result should be more useful than CashMag while remaining recognizably Carfection: white cards on the existing light surfaces, semantic blue/mint/amber/rose treatments, Manrope UI copy, Archivo section headings, and the existing Lucide icon library.

## Source material

- Current Carfection production traceability screenshot supplied by the user.
- CashMag traceability screenshot supplied by the user.
- Approved visual-companion option A: a single chronological column of day-grouped event cards with summary metrics and exception-first styling.
- Existing Carfection Activity feed, device cards, POS page, and global design tokens.

## Goals

1. Preserve strict chronological audit order.
2. Give every event a consistent, card-based information hierarchy.
3. Surface financial values, operators, references, reasons, and status as structured fields.
4. Make reversals, skipped receipts, non-zero till variance, and disabled devices impossible to overlook.
5. Add useful range summaries and category filters without inventing unsupported actions.
6. Remain usable and accessible from 320 px mobile widths through desktop.
7. Stop representing a failed or truncated trace query as a complete empty audit trail.

## Non-goals

- No redesign of the General, Settings, Cash Flow, or global Activity pages.
- No two-column event grid; it would make chronology ambiguous.
- No till-session collapsing in this iteration.
- No new event-detail routes, export workflow, database table, or database migration.
- No parsing structured fields back out of the existing `detail` string.
- No infinite scrolling. A clear cap notice is sufficient for this iteration.

## Access control

Per-device traceability is owner-only, matching the existing owner-only `audit_events` read policy and global Activity access. Managers retain the other Point of Sale tabs, but the Traceability tab is omitted for them and a direct `?tab=trace` request resolves to General without running trace queries. Do not add a privileged service-role fetch or broaden database RLS in this iteration.

## Approved experience

### Page structure

The existing device header and POS tabs stay unchanged. The Traceability tab expands from `max-w-3xl` to a comfortable single reading column within the page's existing `max-w-5xl` shell.

The tab contains, in order:

1. A short description and the existing date-range control.
2. A four-card summary strip.
3. Category-filter chips.
4. Day-grouped ordered lists of event cards.
5. An explicit truncation or unavailable-state notice when required.

### Summary strip

The four cards are:

- **Events** — total loaded events for the selected date range before category filtering.
- **Net payments** — sum of payment-ledger event values, including negative reversal mirrors and excluding any duplicate audit representation.
- **Receipts** — count of printed, skipped, and emailed receipt events.
- **Exceptions** — count of events marked as exceptions.

The summary stays stable when a category chip is selected and describes the globally loaded event window before category filtering. When `capped=true`, a visible `Based on the 150 events shown` label prevents the metrics from claiming to represent the entire period. On mobile it becomes a two-column grid; on desktop it is four columns.

### Filters

Keep the URL-driven From/To date filter. Add URL-driven chips:

- All
- Payments
- Till
- Receipts
- System
- Exceptions

Category selection must preserve `tab=trace`, `from`, `to`, and unrelated query parameters. `Exceptions` is a predicate over exception status rather than a primary category. Filtering occurs after the globally newest 150 events are selected.

The query parameter is `traceCategory`. Allowed values are `payments`, `till`, `receipts`, `system`, and `exceptions`; `All` removes the parameter. Missing or unknown values resolve to `All`.

Search, operator filters, date presets, and saved filter views are deliberately deferred.

### Date-range normalization

Traceability always uses a bounded, inclusive Mauritius calendar-day range. Normalize the URL values once on the server before any source query:

1. A date is valid only when it is an exact real `YYYY-MM-DD` calendar date; regex shape alone is insufficient.
2. When both `from` and `to` are valid, use them and swap them when `to < from`.
3. When exactly one value is valid, use that day for both boundaries.
4. When neither value is valid, including direct navigation with missing or malformed values, use the current Mauritius date for both boundaries.
5. Convert the normalized inclusive days to the half-open instant window `[from 00:00:00+04:00, day-after-to 00:00:00+04:00)`.

The server passes the normalized `from` and `to` strings to the date control as display fallbacks, so the inputs always show the range actually queried. `Clear` removes only the `from` and `to` URL parameters; the displayed and queried range then returns to today. Category and unrelated query parameters remain intact. A reversed or partial direct URL may remain non-canonical in the address bar, but the controls and data must both show the same normalized range.

### Day groups

Events are grouped by Mauritius calendar date. Each section heading shows a human label such as `Today · 14 July` or `Monday · 13 July`, plus the number of events visible after category filtering.

The feed uses semantic `<section>`, `<ol>`, and `<li>` elements. Within equal timestamps, events receive a deterministic secondary order by stable event key so rerenders never jitter.

### Event card anatomy

Each compact card contains:

- a semantic Lucide icon tile;
- a plain-case event title;
- a visible category/status label where useful;
- actor/operator name when known;
- a semantic `<time dateTime>` value;
- amount, method, reference, reason, or version data as separate fields;
- a warning chip for exceptional events;
- a full-card action only when a real `href` exists.

Cards with links use one conditional `Link` wrapper and no nested link. Unlinked events remain non-interactive and do not show a fake chevron or action.

Long emails, reasons, model names, and references use `break-words`. Financial values use `.num` for tabular numerals while retaining the app's Manrope typeface.

### Tone and exception rules

- **Blue** — receipts and document communications.
- **Mint** — normal successful payments.
- **Amber** — till and cash-drawer operations.
- **Neutral grey** — terminal, version, operator, export, and ordinary device events.
- **Rose** — exceptions.

An event is an exception when it is a payment reversal, skipped receipt, disabled device, or till close with non-zero variance. Color is always paired with visible text such as `Reversed`, `Receipt skipped`, `Disabled`, or `Variance`.

### Responsive behavior

- Summary cards: two columns on mobile, four on larger screens.
- Filters wrap into multiple rows; the date controls must not expand the document width.
- Event amount and time remain visible, but may move beneath the main copy on narrow screens.
- Card actions meet a 44 px target and retain the global focus-visible outline.
- No horizontal scrolling is required for the event feed.

## Structured event contract

Extend `TraceEvent` rather than parsing the current flattened `detail` string:

```ts
type TraceCategory = "payments" | "till" | "receipts" | "system";
type TraceTone = "payment" | "till" | "receipt" | "system" | "warning";
type TraceStatus = "reversed" | "receipt_skipped" | "variance" | "disabled" | null;

interface TraceEvent {
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
```

The contract stays presentation-ready and defensive: missing audit payload fields produce `null`, never invented values.

## Data sources and mapping

The feed continues to combine:

- device-stamped `audit_events`;
- raw cash-session open/close events;
- payment-ledger rows;
- derived document-discount events.

Mapping must happen once on the server into structured `TraceEvent` values.

### Normative event mapping

Every retained primary source row emits exactly one event card. The table below is normative; mapper tests use these exact expectations.

| Source event | Emitted kind | Category / tone / status | Structured fields | Link and suppression rule |
|---|---|---|---|---|
| `audit_events.terminal_started` | `terminal_started` | `system / system / null` | actor; model and app version in metadata | no link; key `audit:<id>` |
| `audit_events.app_version_changed` | `version_changed` | `system / system / null` | actor; previous and new version in metadata | no link; key `audit:<id>` |
| `audit_events.signed_in` | `operator_signed_in` | `system / system / null` | actor; no amount | no link; key `audit:<id>` |
| `audit_events.device_enabled` | `device_enabled` | `system / system / null` | actor | no link; key `audit:<id>` |
| `audit_events.device_disabled` | `device_disabled` | `system / warning / disabled` | actor; reason when present | no link; key `audit:<id>` |
| `audit_events.till_cash_out` | `cash_out` | `till / till / null` | actor; negative absolute amount; reason | no link; key `audit:<id>` |
| `audit_events.receipt_printed` | `receipt_printed` | `receipts / receipt / null` | document reference | sale link only when resolved; key `audit:<id>` |
| `audit_events.receipt_skipped` | `receipt_skipped` | `receipts / warning / receipt_skipped` | document reference | sale link only when resolved; key `audit:<id>` |
| `audit_events.receipt_emailed` | `receipt_emailed` | `receipts / receipt / null` | actor; document reference; recipient in metadata | sale link only when resolved; key `audit:<id>` |
| `audit_events.document_sent` | `document_sent` | `receipts / receipt / null` | actor; document reference; channel and recipient in metadata | sale link only when resolved; key `audit:<id>` |
| `audit_events.data_export` | `data_export` | `system / system / null` | actor; report and selected range in metadata | no link; key `audit:<id>` |
| unknown device-stamped audit type | humanized source type | `system / system / null` | actor; no unreviewed raw JSON is exposed | use a validated existing `ref_type/ref_id` link only when an explicit mapping exists; otherwise no link |
| `audit_events.payment_reversed` | no standalone card | n/a | reason and actor are merged into the corresponding negative payment row | always suppressed as a duplicate financial event |
| `audit_events.period_closed` | omitted | n/a | global event has no reliable device attribution | omitted from per-device traceability in this iteration; no claim is made about another feed |
| cash-session open timestamp | `till_opened` | `till / till / null` | actor; opening float as positive amount; session metadata | no link; key `session-open:<id>` |
| cash-session close timestamp | `till_closed` | `till / till / null` when variance is zero, otherwise `till / warning / variance` | actor; signed variance as primary amount; expected, counted, and non-cash totals in metadata | no link; key `session-close:<id>` |
| positive payment ledger row | `payment_received` | `payments / payment / null` | actor; signed positive amount; method; document reference | sale link when document ID exists; key `payment:<id>` |
| negative reversal payment row | `payment_reversed` | `payments / warning / reversed` | reversal actor; signed negative amount; method; reference; required merged reason | sale link when document ID exists; key `payment:<id>`; matching audit row suppressed |
| derived document discount | `discount_applied` | `payments / payment / null` | actor from canonical payment; document reference; whole-sale and line discounts in metadata; no primary amount when mixed percent/fixed discounts prevent a truthful total | sale link when document ID exists; one stable card per document with key `discount:<document-id>` |

`summary` is short human-readable context only. Values already represented by `actorName`, `amountCents`, `method`, `reference`, `reason`, or `metadata` must not be flattened and repeated in `summary`.

### Reversal reasons

The `payment_reversed` audit record stores the required reason against the original payment ID but currently lacks `device_id`. For negative payment rows in the selected device's sessions, fetch matching reversal audit records by original payment ID and merge their reason and actor into the negative payment card. Do not render a second audit card for the same reversal.

This repairs existing historical data without a migration and keeps the payment ledger as the canonical financial event source.

### Discount deduplication

Emit one stable Discount event per document, not one per payment. Its key is `discount:<document-id>`. Its canonical payment is the first positive payment for that document on this device ordered by `(received_at ASC, id ASC)`, obtained with a batched, device-scoped payment lookup for the candidate document IDs. The canonical row supplies both timestamp and actor. Emit the discount only when that canonical timestamp falls inside the selected trace range. Split tenders recorded at different times or at the same timestamp therefore still produce one deterministic card. Aggregate whole-document and line-level discount descriptions into that single event.

Both the line-discount aggregation and canonical-payment lookup must page to exhaustion with a stable `(source timestamp, id)` or `id` keyset rather than trusting the Supabase row cap. Any failed required page makes the trace unavailable; a successful but truncated result is not acceptable audit data.

### Receipt links

Resolve a receipt's sale URL from its document ID when present, otherwise from its document number only when a matching fetched payment document exists. A missing match leaves the card unlinked; it must not guess a destination.

## Component boundaries

### Query layer

`apps/web/src/lib/supabase/queries/pos-devices.ts` remains responsible for fetching device-scoped sources. Add a dedicated `getDeviceTraceability(code, { from, to })` query that returns structured events plus trace state:

```ts
interface DeviceTraceabilityData {
  trace: TraceEvent[];
  traceState: {
  status: "ready" | "unavailable";
  capped: boolean;
  range: { from: string; to: string };
  };
};
```

If any source required for a trustworthy trace fails, return `unavailable` rather than silently presenting a partial ledger as complete.

The page resolves the authorized tab before data loading and calls `getDeviceTraceability` only when an owner is viewing Traceability. The base `getDeviceDashboard` query must not pay the full trace cost on General, Settings, or Cash Flow. Replace General's current dependency on `trace[0]` with a separate cheap `lastActivity` field that preserves its recent-lifetime meaning without loading the bounded trace feed.

### Required-source failure matrix

When trace status is `unavailable`, suppress the summary strip and event feed and render only the retry state. Do not display partial results.

| Query | Requirement | Failure behavior |
|---|---|---|
| device-scoped primary audit rows | always mandatory | trace unavailable |
| device-scoped positive/negative payment rows with document relation | always mandatory | trace unavailable |
| range-bounded cash-session opens | always mandatory | trace unavailable |
| range-bounded cash-session closes | always mandatory | trace unavailable |
| app-user names for every referenced actor ID | always mandatory after primary and conditional enrichment rows are known because actor attribution is audit data | collect the exact non-null actor IDs from audits, payments, sessions, reversal audits, and canonical discount payments; fetch them in complete bounded ID chunks; trace unavailable when any required chunk fails, while a successfully completed lookup with a genuinely missing user row renders an unknown actor |
| reversal audit rows by original payment ID | mandatory only when negative payment candidates exist | trace unavailable when the conditional query fails; a missing matching row renders `Reason unavailable` and remains an exception |
| document and line discount data | mandatory only when candidate payment documents exist | page to exhaustion; trace unavailable when the conditional query or any required page fails |
| canonical earliest device payment lookup for discounted documents | mandatory only when discounted candidate documents exist | page to exhaustion; trace unavailable when the conditional query or any required page fails |
| complete payment rows for retained closing-session IDs | mandatory only when at least one till-close card is retained | trace unavailable when the conditional query or any required result page fails; aggregate all session payments, including those before `from`, for truthful non-cash totals |
| receipt number to sale-link resolution | enrichment only | keep the card unlinked; trace remains ready |

Till movements are not a trace-card source in this iteration. Non-cash closure totals come from the complete conditional closing-session payment enrichment, not from the date-bounded primary payment candidates.

### Pure trace helpers

Create a focused `apps/web/src/features/pos/traceability.ts` module for:

- deterministic sorting;
- category/exception predicates;
- summary calculations;
- Mauritius day grouping;
- filter-option definitions.

These helpers must be pure and directly unit-tested.

### Presentation

Create `apps/web/src/features/pos/TraceabilityPanel.tsx` as a server-renderable presentation component. It receives structured events, trace state including the normalized range, the active category, and current query parameters. It owns the summary strip, filter chips, day groups, card visuals, empty state, cap notice, and unavailable state.

The POS device page delegates the Traceability tab to this component and passes the separately loaded `DeviceTraceabilityData`. The global Activity feed remains unchanged; this iteration reuses its semantic color language, not its component implementation.

## Error, empty, and capped states

- **Unavailable:** a bordered warning card says the audit trail could not be loaded and asks the user to retry. It must not say that no events occurred.
- **Empty period:** a dashed neutral card says no events were recorded in the selected period.
- **Empty filter, uncapped:** the summary remains visible and the feed says no events match the selected category.
- **Empty filter, capped:** the feed says `No loaded events match this filter. Narrow the date range to search beyond the 150 events shown.` It must not claim the entire period has no matching events.
- **Capped:** a visible footer says only the 150 most recent events in the selected period are loaded and asks the user to narrow the date range. It must not imply that a selected category was searched beyond that loaded window.

### Global range-safe cap algorithm

All primary source queries are bounded directly by the selected Mauritius `[from, to]` timestamp window; no query first selects the newest lifetime rows and filters them afterward.

Fetch the newest `TRACE_LIMIT + 1` rows (`151`) independently from each one-row-to-one-event primary stream. Every query must order by its event timestamp descending and then its stable source ID descending so the source boundary matches the emitted-key tie-break:

1. device-scoped audit events by `(created_at DESC, id DESC)`, excluding `payment_reversed` and non-device global events;
2. device-scoped payments by `(received_at DESC, id DESC)`, using the cash-session relationship rather than a lifetime session-ID window;
3. cash-session openings by `(opened_at DESC, id DESC)`;
4. cash-session closings by `(closed_at DESC, id DESC)`.

Conditional reversal and discount enrichment queries operate only on IDs from those candidate streams and do not create duplicate primary events. Discount cards may add events but never remove their canonical payment event. For retained closing-session IDs, fetch every payment page for each session without applying the trace date window, and use that complete set only to calculate the close card's non-cash totals.

Map candidates, merge them, and sort globally by `(at DESC, key DESC)`. Keep the first 151 mapped events; return the first 150 and set `capped=true` when the 151st exists. This is globally safe because any omitted row from a primary stream already has at least 151 newer rows in that same stream and therefore cannot belong to the global newest 151.

Category filtering happens after this global cap. Summary metrics are computed over the returned global 150 before category filtering.

## Accessibility

- Use ordered lists for chronology and `<time dateTime>` for timestamps.
- Every icon has adjacent visible event text; no meaning relies on color alone.
- Linked cards have a single accessible name and full keyboard focus treatment.
- Status chips use readable text.
- Contrast uses the existing tested semantic tokens.
- At 200% zoom and 320 px width, content wraps without page-level overflow.

## Testing strategy

Implementation follows test-driven development.

### Unit tests

- structured mapping for every supported event kind;
- payment reversal reason/actor merge without duplicate cards;
- split-tender discount deduplication;
- deterministic same-timestamp ordering;
- Mauritius date grouping across UTC day boundaries;
- summary totals and exception counts;
- category and exception filtering;
- safe handling of missing or malformed payload fields;
- explicit capped and unavailable trace state.
- normative mapping and suppression behavior for every table entry above;
- mixed-source global-cap ordering where one source dominates;
- an old selected range that lies beyond the newest 400 lifetime sessions;
- a rare category that exists only beyond the global cap and receives the capped empty-filter wording;
- a source-boundary case with more than 151 rows sharing one timestamp, proving stable ID ordering selects the correct global window;
- a session opened before `from` and closed inside the range, proving the close card's non-cash totals include the complete session;
- discount enrichment larger than one Supabase response page, proving aggregation and canonical timestamps remain complete;
- split-tender canonical payments sharing one timestamp, proving `id ASC` selects a deterministic discount actor;
- referenced actor IDs spanning more than one lookup chunk, proving every successful name is retained and any chunk failure makes the trace unavailable;
- missing, malformed, partial, and reversed date parameters, including Clear returning the displayed and queried range to Mauritius today;
- one failure-state regression for every always-mandatory query and every conditionally mandatory query when activated.

### Component tests

- all four summary cards render correct values;
- category chips preserve date and unrelated URL parameters;
- linked cards contain one link and unlinked cards contain none;
- warning labels appear for each exception type;
- empty-period, empty-filter, unavailable, and capped states are distinct;
- semantic ordered-list and time markup is present.
- managers do not receive the Traceability tab, and a direct manager `tab=trace` request resolves to General without loading audit data.

### Verification

- full web test suite;
- TypeScript and changed-file ESLint;
- production web build;
- authenticated browser checks at desktop, tablet, and 320 px mobile widths;
- keyboard and focus checks;
- source screenshot and implementation screenshot reviewed together in the same comparison input.

## Acceptance criteria

1. The Traceability tab uses grouped cards matching approved visual direction A.
2. Chronology remains newest-first and deterministic.
3. Summary metrics reconcile with the loaded structured events.
4. Reversal reasons are visible and split-tender discounts are not duplicated.
5. Exceptions have visible labels and semantic styling.
6. Date and category filters compose through the URL.
7. Real sale links use a full-card target; unsupported actions are absent.
8. Empty, unavailable, filtered-empty, and capped states are truthful and distinct.
9. No page-level overflow occurs at 320 px.
10. Automated tests, type-checking, lint, build, and visual QA pass.
11. An older valid range cannot appear empty merely because newer lifetime rows filled a source cap.
12. Period-close events are not attributed to a device in this iteration.
13. Missing, malformed, partial, reversed, and cleared date inputs produce one explicit normalized range shared by the UI and every source query.
14. Traceability remains owner-only without a service-role bypass or RLS change; managers keep access to the remaining POS tabs.
