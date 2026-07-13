# Sales Performance Chart Design

**Date:** 2026-07-13

**Status:** Approved for implementation

**Surface:** Web dashboard (`/dashboard`)

**Reference:** CashMag “Total incl. tax” sales statistics chart supplied by the client

## Goal

Add a full-width sales chart to the Carfection web dashboard that reproduces the useful behavior of CashMag’s chart while using Carfection’s own business concepts and financial data.

The chart answers two questions at a glance:

1. How much was sold in each time bucket?
2. How was that total divided between workshop jobs and direct/counter sales?

It must show real database values only. Missing days or hours are shown as zero; query failures must never be presented as zero sales.

## CashMag behavior being reproduced

CashMag’s chart uses:

- the Y-axis for money;
- the X-axis for hours when one day is selected and dates when a period is selected;
- a line for total sales including tax; and
- bars for configured sales modes. “Service 1” in the supplied screenshot is a sales-mode label, not a moving average.

Carfection’s equivalent sales modes are:

- **Counter / direct**: documents with `origin = 'standalone'`;
- **Workshop jobs**: documents with `origin = 'from_job'`.

## Placement and access

The chart appears on `/dashboard` immediately after the four KPI cards and before the existing “Collected by method” row.

It inherits the dashboard’s existing access rules. All authenticated users who can see the current dashboard sales KPIs can see this chart. No new navigation item or route is added.

## Financial semantics

### Value plotted

Every plotted value is in integer cents and is based on `documents.total_incl`:

```text
net sales incl. VAT
  = issued invoice totals
  - issued credit-note totals
```

Include:

- invoices with status `issued`, `partly_paid`, or `paid` as positive values;
- credit notes with status `issued` as negative values.

Exclude:

- quotes;
- drafts;
- void invoices;
- void credit notes.

A credit note is applied on the date/time it was issued. It is not moved back to the source invoice’s date. Because credit notes inherit the source document’s origin, their value reduces the correct sales mode.

Payments are deliberately not used. This is a sales-including-VAT chart, not a cash-collected chart.

### Time attribution

Use `documents.issued_at`, converted to Mauritius time (UTC+04:00), as the fiscal event time.

- **Today:** 24 hourly buckets from 00:00 through 23:00 Mauritius time.
- **Multi-day range:** one bucket per Mauritius calendar day, inclusive of both selected dates.

All database filters use a half-open range (`start <= issued_at < end`) with explicit Mauritius offsets. Every expected bucket is emitted even when its value is zero.

### Totals and negative days

For each bucket:

```text
total = counter/direct + workshop jobs
```

The line must equal that calculated total. A net-negative bucket caused by credit notes is valid and is plotted below the zero baseline rather than clamped or hidden.

## Date controls

The chart defaults to **This month** in Mauritius time and offers:

- Today;
- Last 7 days;
- This month;
- Custom date range.

Controls use dashboard URL search parameters so a selected view is linkable and survives refresh. Invalid parameters fall back to This month. Custom ranges are inclusive and limited to 93 days to keep daily labels and interaction usable.

The dashboard’s other lifetime KPI cards remain unchanged by the chart filter. The chart header clearly labels the selected period to avoid implying otherwise.

## Visual design

The chart is a composed line-and-stacked-bar visualization inside the dashboard’s existing white card treatment.

- **Total incl. VAT line:** Carfection link blue (`#1e6fe0`), 2px stroke, visible point on hover/focus.
- **Counter / direct bars:** brand blue (`#2b8cff`).
- **Workshop job bars:** brand purple (`#6a5cff`).
- **Zero baseline:** stronger than ordinary grid lines so negative values remain legible.
- **Grid and axes:** existing `line`, `muted`, and `faint` design tokens.
- **Money labels:** JetBrains Mono via the existing `.num` class.
- **Card typography:** existing Archivo display and Manrope UI styles.

The bars are stacked because their sum is the total represented by the line. When only one mode has sales, the line follows the top of that bar, matching the supplied CashMag example.

The header contains the title, selected-period label, filters, and period total. Hovering or keyboard-focusing a bucket shows:

- full Mauritius date or hour;
- Counter / direct amount;
- Workshop jobs amount;
- Total including VAT.

On narrow screens the plot scrolls horizontally instead of compressing 24–31 labels into unreadable text. The card itself remains within the dashboard width.

## Architecture

### Pure aggregation module

Add a focused module under `apps/web/src/features/dashboard/` that:

- validates and normalizes the requested period;
- builds the required hourly or daily buckets;
- assigns document rows to Mauritius buckets;
- applies invoice/credit-note signs;
- groups values by document origin; and
- returns chart-ready points plus the period total.

The module contains no Supabase or React code and is unit tested directly.

### Data query

Extend the dashboard query to fetch only eligible invoice and credit-note rows within the selected `issued_at` range. Use the repository’s paginated `fetchAllRows` helper so totals cannot be silently truncated by PostgREST’s row limit.

The query supplies raw rows to the pure aggregator. If it fails, the chart receives an explicit unavailable state with a retry-on-refresh message; it does not receive an empty successful series.

### Chart component

Add a small client component using Recharts’ composed chart primitives:

- `ResponsiveContainer` / bounded plot width;
- `ComposedChart`;
- two stacked `Bar` series;
- one `Line` series;
- `XAxis`, `YAxis`, `CartesianGrid`, `ReferenceLine`, legend, and tooltip.

The dashboard page remains a server component and passes serializable chart data into this client component. Recharts is added as a web-workspace dependency; no custom drawing engine is introduced.

## Loading, empty, and error states

- **Successful range with no sales:** render all zero buckets and the message “No issued sales in this period.”
- **Query error:** render “Sales chart unavailable” and explain that refreshing retries it.
- **Negative net range:** retain the signed total and zero baseline.
- **Long labels:** abbreviate axes but preserve the complete value in the tooltip and accessible description.

No fabricated sample values, minimum-height fake bars, or silent error-to-zero fallback is allowed.

## Accessibility

- Wrap the visualization in a named `<figure>`.
- Enable the chart library’s accessibility layer.
- Provide a concise text summary of the period total.
- Provide a screen-reader table containing every bucket and all three values.
- Ensure filters and tooltip targets are keyboard reachable with visible focus.
- Do not rely on color alone: the legend and tooltip name every series, and the line uses a distinct shape from the bars.

## Testing

Development follows red-green-refactor.

Unit tests for the pure module cover:

- 24 zero-filled hourly buckets for Today;
- inclusive, zero-filled daily buckets for longer ranges;
- Mauritius midnight boundaries;
- each included invoice status;
- draft and void exclusion;
- credit-note subtraction on its own issue day;
- standalone versus from-job grouping;
- signed negative buckets;
- total-line reconciliation with both bar series;
- invalid range fallback and custom-range limit.

Verification includes:

- focused unit tests during development;
- the complete web Vitest suite;
- TypeScript compilation;
- production Next.js build;
- ESLint on all files changed for this feature;
- browser inspection of Today and This month at mobile, tablet, and desktop widths;
- comparison against the supplied CashMag reference for axes, series relationship, legend, density, and tooltip behavior.

## Out of scope

- Android dashboard changes;
- payment/collection trends;
- targets, forecasts, or moving averages;
- product/service-category breakdowns;
- per-device filters;
- CSV/PDF export;
- adding configurable sales modes beyond the existing document origins;
- changing existing dashboard KPI calculations.

## Acceptance criteria

The feature is complete when:

1. `/dashboard` displays the full-width chart in the agreed position.
2. Today is hourly; multi-day ranges are daily.
3. The line equals daily/hourly net sales including VAT.
4. The stacked bars reconcile exactly to the line and distinguish direct sales from workshop jobs.
5. Credit notes reduce the correct bucket and mode; drafts and voids never appear.
6. Mauritius day boundaries are correct and missing buckets show zero.
7. Preset and custom filters work through URL state.
8. Empty, negative, mobile, tooltip, keyboard, and query-error states remain clear.
9. Automated tests, TypeScript, the production build, and changed-file lint verification pass.
