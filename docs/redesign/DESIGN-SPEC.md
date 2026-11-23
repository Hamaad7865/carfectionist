# Tyre Centre redesign — design spec

The source of truth is the Kite file: **https://kite.new/p/smyhnsxk7rp2fue4**

| Page in Kite | Frame | PNG in this repo |
|---|---|---|
| Web — light (v2) | Overview (v2) | [screens/web-overview.png](screens/web-overview.png) (1440×920) |
| Web — light (v2) | Checkout (v2) | [screens/web-new-sale.png](screens/web-new-sale.png) (1440×920) |
| Android tablet | Tablet — Till | [screens/tablet-till.png](screens/tablet-till.png) (1280×800 dp, landscape) |
| Android tablet | Tablet — Paid, two receipts | [screens/tablet-paid-receipts.png](screens/tablet-paid-receipts.png) (1280×800 dp) |

The "Web" page in Kite holds an older dark version. **Ignore it**: it was rejected.

Build the screens to match the PNGs. Where the PNG and this document disagree, this document wins
on numbers (colours, sizes); the PNG wins on layout.

All names, prices, BRN/VAT numbers and staff in the mockups are **placeholders**. Real values come
from the database.

---

## 1. Who gets this look

This is the look for the **new tyre-centre client only** (brand key `tyrecentre`, placeholder).
Carfectionist and the HAZ demo keep their current look, **pixel for pixel**. The web picks the brand
from the request host (`apps/web/src/lib/brand.ts` → `brandForHost`). The tablet picks it at build
time (a separate Android product flavor = a separate APK).

---

## 2. Colour tokens

| Token | Hex | Used for |
|---|---|---|
| `app` | `#E8ECF1` | page background behind cards |
| `sidebar` | `#F7F8FA` | sidebar / tablet nav rail background |
| `sidebar-border` | `rgba(15,23,32,0.08)` | sidebar right border, rail border |
| `sidebar-active` | `#EBEEF2` | active menu item background |
| `card` | `#FFFFFF` | cards, cart panel |
| `sub` | `#F4F6F9` | inset areas (size pickers, tip bar, secondary buttons) |
| `track` | `#E2E8EF` | empty progress segments |
| `line` | `rgba(15,23,32,0.07)` | dividers inside cards |
| `ink` | `#111927` | headings, primary text, money |
| `body` | `#2A3747` | normal text, icons |
| `muted` | `#68737F` | secondary text |
| `faint` | `#8C96A1` | labels, captions |
| `fainter` | `#9AA3AD` | mono column headers, empty-dot outlines `#C4CCD6` |
| `primary` | `#0F1720` | **black pill** primary buttons, selected chips, product-selected outline |
| `on-primary` | `#FFFFFF` | |
| `highlight` | `#DDF57A` | lime: "needs attention", "ready to pay", count badges, arrow knob on primary buttons |
| `on-highlight` | `#3F4A00` | text on lime |
| `success` | `#0DA77C` | stock OK, cash drawer open |
| `warning` | `#B07C14` | low stock (3–5 left) |
| `danger` | `#D63B50` | errors, critical stock; soft bg `#FDECEE`, text `#B42339` |
| `avatar` | gradient `#2B8CFF → #6A5CFF` (135°) | user and customer avatars |

### Company (issuing entity) colours

Each issuing company gets a colour set, assigned by its `sort_order`: the first is amber, the
second is blue. Add a fixed palette for any further companies. Do **not** hard-code company names.

| Set | Accent | Soft | Tint (bill background) | Border | Ink (text) | Icon |
|---|---|---|---|---|---|---|
| Entity 1 (Tyre Centre, VAT) | `#F5A623` | `#FFF2DB` | `#FFFBF2` | `#F7E2B8` | `#9A6200` | `#C98200` |
| Entity 2 (Wheel Services, no VAT) | `#2B8CFF` | `#E6F1FF` | `#F5F9FF` | `#CFE2FF` | `#1E6FE0` | `#1E6FE0` |

Dashed dividers inside a bill use the border colour one step darker: `#EBD3A2` for amber and
`#BFD8FA` for blue.

---

## 3. Type

The fonts are the same as Carfectionist's (already loaded in `apps/web/src/app/layout.tsx`).

| Role | Font | Size / weight / tracking |
|---|---|---|
| Page title ("Overview", "New sale") | Archivo | 30 / 600 / −0.6px (tablet 26) |
| Hero number (sales today) | Archivo | 64 / 300 / −2.5px, line-height 64 |
| Big money (to pay, paid) | Archivo | 30–36 / 500 / −1px |
| Change due (tablet) | Archivo | 44 / 600 / −1.5px, colour `highlight` on `primary` |
| Tile price | Archivo | 17 web, 22 tablet / 600 |
| UI text | Manrope | 13–14 / 500–700 |
| Card title | Manrope | 14 / 700 |
| Breadcrumb & micro labels | JetBrains Mono | 10–10.5 / 400–600 / **UPPERCASE**, +0.6 to +1px tracking |
| Money columns in bills & receipts | JetBrains Mono | 13 / 600, right-aligned, tabular |
| Receipt body | JetBrains Mono | 11 |

All money comes from `src/lib/money/` (`Rs 16,180.00`). Never hand-format it.

---

## 4. Shape & depth

- Cards: radius **20–22px** on the web, **22px** for tablet tiles, **24–26px** for the cart panel.
- Card shadow: `0 1px 2px rgba(15,23,32,.04), 0 10px 30px rgba(15,23,32,.05)`; the cart panel uses
  `0 16px 40px rgba(15,23,32,.08)`.
- Pills: `rounded-full` for primary buttons, filter chips, the search field and the segmented control.
- Selected product tile: a 2px ring (2.5px on the tablet), `primary` for entity 1 items and entity 2's
  accent for entity 2 items, plus a qty knob in the top right (black or blue circle).
- Primary button: black pill, white bold label and a **lime circle with an arrow** at the end. Height
  52px on the web, 64px on the tablet.
- Icons: **lucide** (`lucide-react` on the web, matching vectors on Android), 16px in menus, 15–17px
  in buttons, 20–22px on the tablet.

---

## 5. Web components — which library for what

Install **shadcn/ui** (CLI, Tailwind v4, `new-york` style, `neutral` base colour, CSS variables) and
register **HextaUI** as a shadcn registry namespace (`@hextaui`, see https://www.hextaui.com/llms-full.txt
and https://hextaui.com/docs). Map every shadcn/HextaUI CSS variable to the tokens above, scoped to
`[data-brand="tyrecentre"]`.

| UI piece | Component | Notes |
|---|---|---|
| App sidebar | **shadcn `sidebar`** (`SidebarProvider`, `Sidebar collapsible="icon"`, `SidebarHeader`, `SidebarGroup`/`Label`, `SidebarMenu*`, `SidebarMenuBadge`, `SidebarMenuSub` + `Collapsible`, `SidebarFooter`, `SidebarRail`, `SidebarTrigger`) | Expanded (256px) everywhere; **collapsed to icons (56px)** on New sale. See §6.1 |
| Company switcher (sidebar header) | shadcn `dropdown-menu` | lists shops/companies the user can see |
| User menu (sidebar footer) | shadcn `dropdown-menu` + `avatar` | |
| Search with ⌘K hint | shadcn `command` (dialog) + HextaUI `kbd` | |
| Today / 7 days / 30 days | HextaUI `toggle-group` (fallback shadcn `toggle-group`) | pill style |
| Cards | HextaUI `card` (fallback shadcn `card`) | radius and shadow from §4 |
| Status & company chips | HextaUI `badge` (fallback shadcn `badge`) | variants: `attention` (lime), `entity-1`, `entity-2`, `danger`, `outline`, `neutral` |
| Tabs (Active / Ready to pay / Done) | shadcn `tabs` (underline variant) | |
| Jobs table | shadcn `table` (or HextaUI `table`) | mono uppercase headers |
| Tyre size pickers | shadcn `select` | three selects: width / profile / rim |
| Filter chips (All / Tyres / Parts / Services) | HextaUI `toggle-group` / `chip` | single-select |
| Payment method segmented (Cash/Card/Juice/Split) | `toggle-group` | |
| Approve / Decline, Order more, Add again | shadcn `button` variants `default` (black pill), `outline` | |
| Toasts | shadcn `sonner` | |
| Dot chart (sales by hour) | **custom SVG component** | see §6.2; give it an accessible `<table>` fallback |
| Segmented progress (job steps) | custom | 6 segments of 16×12px, radius 3 |

Prefer HextaUI where it has the component; otherwise use shadcn. Never mix two libraries for the
same piece. Keep generated components in `apps/web/src/components/ui/` and don't hand-edit their
internals beyond token mapping.

---

## 6. Screens

### 6.1 Sidebar (web) — shadcn sidebar, expanded

Width 256px, background `sidebar`, 1px right border, padding 8px.

1. **Header:** team switcher. A 32×32 black rounded-8 square with the logo, then "Tyre Centre"
   (14/700) over "Port Louis shop" (12, muted), then ⇅.
2. **Group "Shop floor"** (label 12/600, faint):
   - Overview (active: `sidebar-active`, 600)
   - New sale, with a `F2` kbd hint
   - Jobs, with a lime badge for the count of jobs that need you
   - Customers & cars
   - Documents, collapsible and open, with sub-items Quotes, Invoices (red "N unpaid") and Credit notes
   - Tyre stock, with a red "N low" badge
   - Reports ›
3. **Group "Companies"**, with a "+" action (owner only): one row per issuing company, a 16px
   colour square, its name, and a mono `VAT` / `NO VAT` tag in the company's ink colour.
4. **Group "Till":** "Cash drawer" with a green "● Open" or grey "Closed", and "Close the day".
5. **Bottom:** Help, Settings.
6. **Footer** (top border): the user's 32px avatar (gradient, initials), name (14/600), role (12,
   muted), and ⇅ for the user menu.

Menu rows are 32px tall, radius 6, gap 8, with 16px icons. **Collapsed** (`collapsible="icon"`,
56px): logo, the icons only, a divider, one colour square per company, then settings and the avatar
at the bottom. Tooltips show the labels.

Show only what the user's role and modules allow (reuse the current `Sidebar.tsx` role/module filtering).

### 6.2 Overview (web) — `screens/web-overview.png`

Main padding 20px 24px; sections 14px apart.

- **Header row:** mono breadcrumb `TYRE CENTRE / OVERVIEW`; title "Overview"; a mono line
  `Saturday, 21 November · 13:54 · till open since 08:02`. On the right: the Today/7 days/30 days
  toggle, a round refresh button and a black "+ New sale" pill.
- **Sales hero card:**
  - Top row: title "Sales today", a legend of mono uppercase dots (one per company plus "BOOKED"
    as an outline dot), and "Open sales journal →".
  - Left column (330px):
    - the hero number (sales incl. VAT for the period), with a lime `↑ 12.4%` badge and
      "vs last Saturday · Rs, VAT incl.";
    - one dashed-separated row per company with its total (mono);
    - "VAT collected".
  - Right: the **dot chart**. One column per hour slot. Each dot (10px, 4px gap) is one sale,
    coloured by company: entity 1 = `primary` black, entity 2 = entity 2 accent, stacked bottom-up.
    Future slots show booked jobs as outline dots (`#C4CCD6`). A 2px black "now" line, and an
    x-axis of mono hours with `NOW HH:MM` in bold.
  - Bottom: a **tip bar** (`sub` background): a black square with a lime sparkle icon, a sentence,
    and a black "Order more" pill. **Only show a tip that real data supports** (e.g. a tyre size
    whose stock fell below its reorder level). Otherwise hide the bar.
- **Bottom row:**
  - **"In the bays"** card (flex). Tabs Active / Ready to pay / Done with counts. Columns:
    - CAR: a car icon tile, the plate (13/700), and a mono lowercase model · work summary;
    - PROGRESS: 6 segments, filled = steps done; red = blocked;
    - BILLS TO: one company badge per company that has lines on the job;
    - STATUS: a badge. Lime = ready to pay, outline = in bay N, danger = waiting for stock,
      neutral = checked in · time.
  - **"Needs you"** card (320px), with a lime count badge. Items are cards with a mono header
    (`◎ TYPE · REF`, age on the right), a 13/700 title, a 11.5 muted reason, and actions
    (black Approve / outline Decline, or a single outline action). Only include item types the
    system really has (discount above limit, stale open till, short delivery); hide the rest.

### 6.3 New sale (web) — `screens/web-new-sale.png`

Sidebar collapsed. Catalogue on the left (padding 20/24), cart panel 420px on the right (margin 14px).

- **Header:** mono breadcrumb, title "New sale", a 340px pill search (placeholder "Search size,
  brand or service", `/` kbd), and a round barcode-scan button.
- **Tyre size card:** a mono `TYRE SIZE` label, three selects (Width 195 / Profile 65 / Rim R15,
  values bold mono), and a lime pill "From <plate>" that fills the selects from the chosen car's
  last tyre size.
- **Filter chips:** All (black) · Tyres (amber dot, count) · Parts · Services (blue dot). On the
  right, a mono `SORT · BEST SELLER`.
- **Product grid:** 3 columns, gap 12.
  - Tyre tiles: a tyre glyph (52px circle with a 9px dark ring), the brand in mono uppercase, the
    model 14.5/700, size · load index, the price (Archivo 17), and stock ("12 in shop" green, ≤5
    warning colour).
  - Parts tiles: an icon in an amber soft square.
  - Service tiles: an icon in a blue soft square, `SERVICE`, and a mono `NO VAT` when the company is
    not VAT-registered.
  - A tile that is in the cart gets the ring and a qty knob (§4).
- **Car history card:** "<plate> · last visits", "Full history →". Rows: mono date, a summary, mono
  km, and an outline "↺ Add again".
- **Cart panel:**
  - Customer header: a 40px gradient avatar, name 15/700, mono `PLATE · MODEL · KM`, and an
    edit button.
  - **One bill block per company**, in sort order, using the company tint/border colours. Header:
    an icon tile, the company name 13.5/700, and a mono `INVOICE n OF N · VAT 15%` or
    `… · NOT VAT-REGISTERED`. Then lines (mono qty, name, mono amount). VAT company: subtotal
    excl. VAT, VAT 15% and Total. Non-VAT company: Total only.
  - Info bar: "One payment, **two receipts**. Each company's invoice number is given when you
    charge." Show it only when there is more than one bill.
  - Footer: mono `TO PAY · N INVOICES`, the amount in Archivo 32/500, the method toggle-group,
    the **Charge** black pill (52px) with a lime arrow knob, and text links Save as job / Make a
    quote / Clear.
  - **Never show an invoice number before charging.** Numbers are minted by `issue_document` only.

### 6.4 Tablet till — `screens/tablet-till.png` (1280×800 dp)

- Status bar 28dp. Below it, a row with 12dp side padding.
- **Nav rail** 88dp: `sidebar` background, 1dp border, radius 16, light shadow. Logo square 40dp.
  Items are 72×60dp, radius 10, icon 20 + label 11.5 (active: `sidebar-active`, 700). Items: Till,
  Jobs, Cars, Quotes, Stock; at the bottom Lock, a divider, and the avatar.
- **Catalogue:**
  - Header: a mono `TILL · <device code> · OPEN HH:MM`, title 26, a 300×52dp search pill, and a
    52dp black scan button.
  - Chips are 46dp tall, plus a lime "<tyre size>" chip.
  - Tiles 3×N, 150dp tall, radius 22: mono brand/`SERVICE · NO VAT`, name 16/700, sub 12.5,
    price Archivo 22, stock. A 36dp qty knob when the item is in the cart.
  - The last tile is a dashed **"Custom line · Pick the company"**: an ad-hoc line must say which
    company it belongs to.
- **Cart** 390dp, radius 26: the customer header (44dp avatar), one bill block per company (same as
  the web), and a footer with `TO PAY · N RECEIPTS`, Archivo 30, two 54dp secondary buttons
  (Split, Save job), and a **64dp Charge** pill.

### 6.5 Tablet paid — `screens/tablet-paid-receipts.png`

- **Result panel** 400dp:
  - a 64dp lime circle with a check;
  - a mono `PAID · <METHOD> · N RECEIPTS` and the total in Archivo 36;
  - a black **GIVE CHANGE** card with the change in Archivo 44, lime, and "Tendered Rs …";
  - one row per issued invoice: the company colour square, company · **number** (mono bold), amount;
  - Print again and WhatsApp (54dp), and a 64dp **New sale** pill.
- **Printed receipts:** one thermal-slip preview per company, side by side (300dp wide, mono 11, a
  5dp top border in the company accent). These previews must be rendered **by the same receipt code
  that prints** (receipt parity rule: web `ReceiptCard` ≡ tablet `ReceiptText`/`ReceiptPaper`).
  - **VAT company slip:** `VAT INVOICE`, BRN and VAT number, lines, subtotal excl. VAT, VAT 15%, TOTAL.
  - **Non-VAT company slip:** `INVOICE`, BRN only, lines, TOTAL, "Not VAT-registered". No VAT lines,
    no VAT number.

---

## 7. Android (Compose) mapping

- New product flavor `tyrecentre` (dimension `brand`). Carfectionist's current build becomes flavor
  `carfectionist` with **unchanged** `applicationId` `mu.carfection.pos`, so existing installs keep
  updating. Give `tyrecentre` its own `applicationId` (placeholder `mu.haz.tyrecentre.pos`) and app
  name/icon.
- Turn today's top-level colour `val`s in `ui/theme/Theme.kt` into a `BrandTokens` data class
  provided through a `CompositionLocal`. Carfectionist's values stay **identical**. The `tyrecentre`
  flavor supplies the tokens in §2.
- Fonts: bundle Manrope, Archivo and JetBrains Mono (OFL) in the `tyrecentre` flavor's `res/font`.
  Carfectionist keeps Barlow / IBM Plex Mono.
- Shared composables (tiles, bill block, pills, nav rail) read only from `BrandTokens`. Where the
  layout differs, use flavor-specific composables, keeping the ViewModels and the data layer shared.
- Touch targets are ≥ 48dp everywhere (the design uses 46–64dp).
