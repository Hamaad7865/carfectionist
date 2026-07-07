# Design tokens — extracted EXACT from `Detailing-POS.html`

These are the authoritative values. They are already mirrored 1:1 in the Compose
source of truth: `android/app/src/main/java/mu/carfection/pos/ui/theme/Theme.kt`.
Never re-guess a value inline — reference the `Theme.kt` `val`s.

## Color
| Role | Hex | Theme.kt |
|---|---|---|
| Accent (teal `--ac`) | `#0FBFA6` | `Accent` |
| Accent ink (on accent) | `#FFFFFF` | `AccentInk` |
| Accent soft (@14%) | `rgba(15,191,166,.14)` | `AccentSoft` |
| Accent line (@45%) | `rgba(15,191,166,.45)` | `AccentLine` |
| Accent gradient partner | `#3E8BFF` (cert adds `#7C5CE8`) | `AccentBlue` |
| Screen bg (main) | `#F2F4F7` | `ScreenBg` |
| Surface / cards | `#FFFFFF` | `CardBg` |
| Inset (inputs/display cards) | `#EEF1F5` | `Inset` |
| Inset alt (keys/chips/tiles-unsel) | `#E8ECF1` | `InsetAlt` |
| Product tile | `#F6F8FA` | `Tile` |
| Text primary | `#17202A` | `TextPrimary` |
| Text secondary | `#5B6B7A` | `TextSecondary` |
| Text muted / labels | `#8494A3` | `TextMuted` |
| Hairline border | `rgba(15,26,36,.08)` | `Hairline` |
| Success / paid / change | `#1FA361` | `Success` |
| Warning / balance / on-account | `#C17A00` | `Warning` |
| Danger / remove / cancel | `#D63A3A` | `Danger` |
| Plate badge | `#F0C542` (text `#151208`) | `Plate` |
| Method-mix: Cash/Card/Juice/Bank | `#1FA361` / `#2A6FDB` / `#C17A00` / `#7C5CE8` | — |

## Type (Google Fonts, bundled in res/font)
- Body: **Barlow** 400/500/600/700/800 → `Barlow` (also the default text style)
- Headings / big numbers: **Barlow Condensed** 500/600/700 → `Condensed`
- Money / refs / codes: **IBM Plex Mono** 400/500 → `Mono`
- Screen title: `Condensed` 24px/700, tracking 1.5, UPPERCASE
- Modal title: `Condensed` 20px/700, tracking 1.2
- Section labels: `Barlow` 9.5–11px/700, tracking 1.3–1.6, UPPERCASE, `TextMuted`
- Big totals: `Condensed` 22–30px/700 ; amount displays `Condensed` 24
- Numpad keys: `Barlow` 20/600

## Radius
modals 22 · cards 14–16 · display cards/inputs/method chips 12 · keys 12 ·
pills 19–21 (fully round) · plate 4–5 · toast 14 · screen 14

## Spacing
screen padding `14 16 12` · card internal gap 6–12 · numpad gap 7 · method-row gap 7 ·
card padding 12–14 / 15–17 · modal padding 18 20

## Shadow
primary CTA `0 8px 28px var(--ac-soft)` · toast `0 12px 40px rgba(15,26,36,.18)` ·
job sheet `-30px 0 80px rgba(15,26,36,.20)`

## Layout skeleton (all screens)
Header 58px (logo tile + name + time/date + sync pill + staff chip) ·
Left nav rail 86px (7 stacked icon+label buttons; active = accent@13% bg + accent) ·
Main area `#F2F4F7`, `position:absolute inset:0; padding 14/16/12`.

## Motion
`fadeUp` (modals rise 12px + fade, .22s) · `sheetIn` (detail sheet slides 48px, .22s) ·
`acPulse` (sync dot) · `toastPop` · button press `scale(.93–.98)`.
