# Front-end re-skin — Claude Design handoff (LIGHT theme)

Applying `claude-design-prompts/project/Carfection Back Office.dc.html` (light)
to the built web app. Scope: **re-skin what's built** (shell + dashboard + sales
list + document builder/preview + document detail/payments + settings);
Phase-2/3 screens stay as light placeholders until their real phases.

## Design tokens
- Fonts: **Archivo** (display), **Manrope** (UI), **JetBrains Mono** (numbers)
- Ink `#111927`/`#172130`, body `#2a3747`, muted `#68737f`, faint `#8c96a1`
- Surfaces: `#ffffff` cards, `#f6f8fb` inputs, `#eff3f7` bands; borders `rgba(15,23,32,.06–.12)`
- Brand gradient `#2b8cff → #4f74ff → #6a5cff`; link `#1e6fe0`
- Teal `#0da77c`/`#10b5aa`, amber `#f5a623`, danger `#d63b50`/`#ff5468`

## Phases (each: implement → build → browser-verify light render → commit)
- [x] A. **Design system + shell** — globals tokens + fonts; Sidebar, Topbar,
  Brand, StatusPill, PagePlaceholder re-skinned light.
- [x] B. **Dashboard** — KPI cards, revenue chart, payment donut, technician
  performance, best-sellers, recent invoices (real data where available).
- [x] C. **Sales list** — tabs + status chips + table (Number/Customer/Date/
  Method/Status/Total) + footer count/total.
- [x] D. **Document builder** — controls (doc-type toggle, catalogue search,
  ad-hoc entry, qty steppers, per-line VAT, sections, custom fields) + live preview.
- [x] E. **Document detail + payments** — re-skin detail summary + payment form.
- [x] F. **Settings + placeholders** — settings/templates re-skin; Phase-2/3
  placeholder pages light; remove old dark tokens.

## Notes
_(one line per phase)_
- A. Light tokens + Archivo/Manrope/JetBrains fonts; shell (Sidebar/Topbar/Brand/StatusPill/PagePlaceholder) re-skinned.
- B. Dashboard: KPI cards (invoiced/collected/outstanding/count), collected-by-method donut, catalogue, recent docs, best-sellers — all real data.
- C. Sales list: type tabs + status chips filter bar, comp grid table (Number/Customer/Date/Method/Status/Total), count+total footer.
- D. Builder re-skinned to comp: light split layout, doc-type toggle, bill-to chips, catalogue search, ad-hoc entry, qty steppers, per-line VAT toggle, section switches; DocumentA4 preview kept as the fiscal artifact.
- E. Document detail + RecordPaymentForm + ConvertButton re-skinned light.
- F. Settings/templates + login re-skinned; placeholder pages already light via PagePlaceholder; legacy dark tokens removed (grep-verified no remaining users).

## Build-out (comp screens with real data)
- [x] G. Contacts — customers master-detail (list, vehicles, lifetime spend, outstanding, service history) + suppliers tab. Verified live.
- [x] H. Products & Inventory — catalogue table (cost/sell/margin/store/floor/on-hand + LOW badges); transfers/recipes tabs stubbed for Phase 2/3. Verified live.
- Template SAVE verified end-to-end (clicked Save → persisted).