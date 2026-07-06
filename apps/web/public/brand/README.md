# Brand artwork for quote / invoice documents

These images render on the A4 quote & invoice (`DocumentA4`) — the header banner
across the top and the footer banner at the bottom. The default template points
at them via `header_banner_path` / `footer_banner_path` (Settings → Templates).

- `header.png` — Carfectionist logo banner (full-width top band).
- `footer.jpg` — "Covered by Diamonds" banner (centred bottom band, max ~120px tall).

To swap artwork: replace these files (same names = no config change), or add new
files here and update the Header/Footer banner URL in Settings → Templates
(e.g. `/brand/header-v2.png`). Any web image format works. Dark backgrounds
(#0e1013-ish) blend best with the document's dark bands.
