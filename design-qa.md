# Sales Performance Chart Design QA

## Comparison target

- Source visual truth: `C:\Users\sheik\AppData\Local\Temp\codex-clipboard-226511b4-e003-45f4-9dfa-caf6ea406346.png`
- Browser-rendered implementation: `http://localhost:3001/dashboard?salesRange=month`
- Primary viewport and state: Chrome, 1280 x 900, authenticated dashboard, `This month` (1-13 July 2026)
- Final full-view evidence: `.superpowers/sdd/sales-chart-month-desktop-full-final.png`
- Final focused evidence: `.superpowers/sdd/sales-chart-month-desktop-focus-final.png`
- Tooltip and keyboard-focus evidence: `.superpowers/sdd/sales-chart-keyboard-focus.png`
- Hover-state chart capture (popup not visible in the raster): `.superpowers/sdd/sales-chart-month-tooltip.png`
- Responsive evidence: `.superpowers/sdd/sales-chart-today-mobile-top-fixed.png`, `.superpowers/sdd/sales-chart-today-mobile.png`, `.superpowers/sdd/sales-chart-today-mobile-scrolled.png`, `.superpowers/sdd/sales-chart-month-mobile.png`, `.superpowers/sdd/sales-chart-last7-tablet.png`
- Custom-range evidence: `.superpowers/sdd/sales-chart-custom-tablet.png`

The source and final implementation screenshots were opened together in the same comparison input for both full-view and focused-chart review. The source is a photographed CashMag browser screen, while the implementation evidence is a direct browser capture; browser chrome, camera angle, and moire in the source are therefore not fidelity targets.

## Reference behavior

- Money on the Y-axis and time on the X-axis.
- Filled sales-mode bars with a total-including-tax line.
- A visible legend and exact hover detail.
- Daily buckets over a range and hourly buckets for one day.

## Required fidelity surfaces

### Fonts and typography

The implementation keeps Carfection's established Archivo display, Manrope UI, and JetBrains Mono financial-number treatment rather than copying CashMag's generic browser typography. Hierarchy matches the reference intent: the chart title is strongest, the date context is secondary, money ticks are compact, and the total-including-VAT figure is prominent. Axis labels remain readable at desktop/tablet widths and remain available through horizontal scrolling at 320 px.

### Spacing and layout rhythm

The chart is a full-width dashboard card directly after the KPI grid and before the payment-method/catalogue row. Its header, controls, plot, and legend form one clear region. Desktop margins and grid alignment follow the existing dashboard cards. At 320 px the preset buttons and two labelled date fields wrap into usable rows while the plot retains its intended density through contained horizontal scrolling.

### Colors and visual tokens

CashMag's blue filled bars plus blue total line are preserved as the primary visual relationship. Carfection uses its existing blue for Counter/direct, a related dark blue for Total incl. VAT, and its existing purple for Workshop jobs. Grid lines, borders, muted labels, selected states, and white surfaces use the existing product tokens with adequate contrast.

### Image quality and asset fidelity

Not applicable: the target chart contains no photographic, illustrative, logo, or custom icon asset that needed substitution. The implementation uses native chart primitives and the app's existing icon system; no image asset was replaced with CSS art, inline SVG art, emoji, or placeholder imagery.

### Copy and content

CashMag's ambiguous `Service 1` is intentionally adapted to the client's real sales origins: `Counter / direct` and `Workshop jobs`. `Total incl. VAT`, `Sales performance`, period labels, empty/error copy, and exact MUR tooltip values are clear and standalone.

## Controls, states, accessibility, and responsiveness

- `Today`, `7 days`, and `This month` were exercised in the browser; the pressed state, period label, date values, and URL updated together.
- An unrelated `qaMarker=keep` parameter survived preset changes, confirming URL preservation.
- A valid custom route for 10-12 July rendered both selected date values and the correct inclusive label. The segmented native Chrome date field accepted keyboard focus/input; browser automation emitted partial intermediate native-date values, so final custom-route rendering was also verified directly. Component tests cover the complete custom update and unrelated-parameter preservation contracts.
- Hovering Sunday 12 July showed `Counter / direct Rs 35,234.62`, `Workshop jobs Rs 0.00`, and `Total incl. VAT Rs 35,234.62`.
- Keyboard interaction focused the plot region itself (`role=region`, `aria-label=Sales chart plot`, `tabIndex=0`). A screen-reader-only table exposes exact MUR values for every bucket.
- At 320 px the plot measured 236 px client width and 912 px scroll width. Horizontal interaction moved `scrollLeft` from 0 to 450 and exposed later hours/legend content without expanding the page.
- Live month/today data exposed honest zero baselines. Negative credit-note behavior and zero/unavailable states are covered by the sales model and rendered-chart tests because live data did not contain a negative bucket.
- Browser viewports checked: Today at 1280 and 320 px; Last 7 days at 768 px; This month at 1280 and 320 px; custom range at 768 px.

## Console check

There were zero app-origin warnings or errors. Chrome reported eight development-only hydration messages from `chrome-extension://fmkadmapgofadopljbjfkapdkoienihi/build/installHook.js`; every trace identified extension-injected `fdprocessedid` attributes. The visible Next development issue badge in some evidence is therefore an external browser-extension artifact, not a product/runtime failure.

## Findings

- P0: none.
- P1: none.
- P2: none remaining.
- P3: the selected Chrome profile's form-filling extension creates a development-only hydration badge; use a clean profile or production preview for presentation captures if a badge-free full-dashboard image is required.

## Comparison and fix history

### Pass 1 - desktop and focused comparison

- Evidence: source image plus `.superpowers/sdd/sales-chart-month-desktop-focus.png` and `.superpowers/sdd/sales-chart-month-desktop-full.png` in the same comparison input.
- Result: the bar/line relationship, money/time axes, legend, composition, Carfection typography, colors, and copy matched the approved reference behavior. No chart-specific P0/P1/P2 finding.

### Pass 1 - mobile finding

- Finding: P2 at 320 px. The two-column KPI cards clipped the full invoiced and collected values above the new chart, weakening the mobile dashboard hierarchy.
- Fix: retained the existing desktop 27 px value size, added an 18 px base size and 23 px intermediate size in `DashboardPage` so the complete MUR amounts wrap cleanly within each card.

### Pass 2 - mobile post-fix comparison

- Evidence: `.superpowers/sdd/sales-chart-today-mobile-top-fixed.png`.
- Result: `Rs 49,327.82`, `Rs 53,576.02`, `Rs 0.00`, and the invoice count are fully visible; chart controls still wrap cleanly. The earlier P2 is resolved.

### Final full and focused comparison

- Evidence: source image plus `.superpowers/sdd/sales-chart-month-desktop-full-final.png` and `.superpowers/sdd/sales-chart-month-desktop-focus-final.png`, opened together in the same comparison input after the mobile fix.
- Result: no actionable P0/P1/P2 difference remains. The implementation is intentionally Carfection-branded while matching CashMag's sales-statistics behavior and visual relationship.

## Local checks

- [x] Series meaning matches the reference.
- [x] Total line reconciles to stacked modes.
- [x] Axis labels remain readable or horizontally reachable.
- [x] Tooltip uses exact MUR amounts.
- [x] Empty and error states do not fabricate sales.
- [x] Mobile chart remains usable through horizontal scroll.
- [x] Keyboard and screen-reader equivalents are present.
- [x] Fonts/typography, spacing/layout, colors/tokens, image fidelity, and copy/content were explicitly reviewed.

final result: passed
