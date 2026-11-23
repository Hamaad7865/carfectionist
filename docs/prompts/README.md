# Copilot prompts — Tyre Centre client

Run them **in this order**, each on its own branch. Wait for each one's plan, approve it, and merge
it before starting the next.

| # | Prompt | What it builds | Attach to the chat |
|---|---|---|---|
| 1 | [two-company-billing.md](two-company-billing.md) | One business, two issuing companies (VAT + non-VAT). One checkout produces one invoice per company, each with its own number series. Web + tablet + reports. | nothing |
| 2 | [redesign.md](redesign.md) | The new look for this client only: shadcn + HextaUI on the web, a new Android flavor. Carfectionist stays unchanged. | the 4 PNGs in [`../redesign/screens/`](../redesign/screens/) |

## Design files

- Live design (Kite): https://kite.new/p/smyhnsxk7rp2fue4. Use the pages **"Web — light (v2)"** and
  **"Android tablet"**. The dark "Web" page was rejected.
- Spec: [`../redesign/DESIGN-SPEC.md`](../redesign/DESIGN-SPEC.md)
- Mockups: [`../redesign/screens/`](../redesign/screens/)
  - `web-overview.png`
  - `web-new-sale.png`
  - `tablet-till.png`
  - `tablet-paid-receipts.png`

## Before you start

- Ask the client's accountant to confirm the VAT split between the two companies.
- Collect for each company: legal name, BRN, VAT number (VAT company only), address, logo, and the
  invoice number prefixes they want.
- Pick the client's web address (the redesign shows only on that host) and the tablet app name.
