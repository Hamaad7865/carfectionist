import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptCard } from "./ReceiptCard";
import type { ReceiptData, ReceiptLine, ReceiptTender } from "@/lib/supabase/queries/receipt";

/**
 * The slip as it actually renders — ordering, emphasis and money formatting, checked on the
 * markup rather than on the source. This is the half the totals test can't reach: a correct
 * `subtotalInclCents` printed in the wrong place, or a bold line that should be light, is still
 * a slip that doesn't match the tablet.
 */

const line = (over: Partial<ReceiptLine>): ReceiptLine => ({
  qty: 1, title: "ITEM", unitInclCents: 0, totalInclCents: 0, fullInclCents: 0,
  discountInclCents: 0, discountPct: 0, discountLabel: null,
  unitExclCents: 0, totalExclCents: 0, vatRate: 15,
  ...over,
});

const tender = (over: Partial<ReceiptTender>): ReceiptTender =>
  ({ method: "CARD", count: 1, amountCents: 155045, isReversal: false, ...over });

/** The owner's reference receipt: 25-07-2026, ticket No. 11, INV-0031, paid by card. */
const reference = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  studioName: "Carfectionist",
  logoUrl: null,
  address: "Helvetia, 80840 Moka, MU",
  brn: "C22190760",
  vatNo: "VAT28070619",
  phone: "+230 5258 8854",
  number: "INV-0031",
  docLabel: "Invoice",
  saleModeLabel: "Sale - SALES [CARFECTIONIST]",
  ticketNo: 11,
  billLabel: "Bill 1-N00000028",
  terminalNo: 1,
  voided: false,
  isInvoice: true,
  dateTime: "25-07-2026 12:08:44",
  dateLabel: "25 Jul 2026, 12:08",
  cashier: "ANSHIKA",
  customerName: "Walk-in customer",
  customerEmail: null,
  customerBrn: "",
  customerVatNo: "",
  lines: [
    line({ title: "HANGING CAR DIFFU", unitInclCents: 173800, fullInclCents: 173800, totalInclCents: 112970, discountInclCents: 60830, discountPct: 35, discountLabel: "35%" }),
    line({ title: "SAVORE CARD AIR FR", unitInclCents: 49500, fullInclCents: 49500, totalInclCents: 42075, discountInclCents: 7425, discountPct: 15, discountLabel: "15%" }),
  ],
  subtotalInclCents: 223300,
  subtotalCents: 134822,
  discountInclCents: 68255,
  vatCents: 20223,
  totalCents: 155045,
  paidCents: 155045,
  changeCents: 0,
  balanceDueCents: 0,
  methodLabel: "card",
  paid: true,
  vatGroups: [{ rate: 15, baseCents: 134822, vatCents: 20223, inclCents: 155045 }],
  payments: [tender({})],
  paymentDetail: [{ at: "25/07/2026 12:08", method: "CARD", amountCents: 155045, isReversal: false }],
  footerNote: "Thank you for visiting.",
  barcodeValue: "INV-0031",
  codeLabel: "INV-0031 · 25072026",
  // null = no customer named on the bill — the reference sale is a walk-in, same as the
  // tablet's referenceDoc(). Tests below override both together for a named customer.
  pointsEarned: null,
  pointsBalanceAfter: null,
  ...over,
});

const render = (over: Partial<ReceiptData> = {}) => renderToStaticMarkup(<ReceiptCard r={reference(over)} />);

/** The inline style of the nearest element opening before [text] — how we read its emphasis. */
function styleAround(html: string, text: string): string {
  const at = html.indexOf(text);
  expect(at, `not rendered: ${text}`).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<div", at);
  return /style="([^"]*)"/.exec(html.slice(open, at))?.[1] ?? "";
}
const order = (html: string, ...parts: string[]) =>
  parts.map((p) => {
    const i = html.indexOf(p);
    expect(i, `not rendered: ${p}`).toBeGreaterThan(-1);
    return i;
  });

describe("the slip renders the reference sale in the reference's order", () => {
  const html = render();

  it("runs identity → numbered sale → items → totals → tender → tax → fiscal footer", () => {
    const seen = order(
      html,
      "Helvetia", "80840 Moka, MU",
      "No. 11", "NUM VAT INVOICE INV-0031", "Bill 1-N00000028", "Sale - SALES [CARFECTIONIST]", "25-07-2026 12:08:44",
      "Designation", "HANGING CAR DIFFU", "Initial price", "SAVORE CARD AIR FR",
      "Subtotal :", "Discount :", "Total:", "excl. VAT :",
      // "CARD : ", not "CARD" — the second item is a SAVORE CARD AIR FR.
      "CARD : ", "TAUX NORMAL", "Thank you for visiting.",
      "Appareil 1", "BRN : C22190760", "VAT number : 28070619", "ANSHIKA",
    );
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("puts the Bill reference directly under the VAT invoice number", () => {
    expect(html).toMatch(/NUM VAT INVOICE INV-0031<\/div><div[^>]*>Bill 1-N00000028</);
  });

  it("splits the address into two centred lines", () => {
    expect(html).toContain(">Helvetia</div>");
    expect(html).toContain(">80840 Moka, MU</div>");
  });

  it("strips the stored VAT prefix and states the number under its own label", () => {
    expect(html).toContain("VAT number : 28070619");
    expect(html).not.toContain("VAT number : VAT28070619");
  });
});

describe("money prints as the reference does", () => {
  const html = render();

  it("uses 2dp with NO thousands separator", () => {
    expect(html).toContain("2233.00");   // never "2,233.00"
    expect(html).toContain("1738.00");
    expect(html).not.toMatch(/\d,\d{3}\.\d{2}/);
  });

  it("suffixes the unit on the figures the reference suffixes", () => {
    expect(html).toContain("1550.45Rs");         // Total:
    expect(html).toContain("1348.22Rs");         // excl. VAT
    expect(html).toContain("TAUX NORMAL 15.0% : ");
    expect(html).toContain("202.23Rs");
    expect(html).toContain("excl. VAT = ");
    expect(html).toContain("Incl. tax = ");
  });

  it("spells each line's saving out beneath it, in the reference's words", () => {
    expect(html).toContain("Initial price : ");
    expect(html).toContain("Discount 35.0% / ");
    expect(html).toContain("608.30");
    expect(html).toContain("Discount 15.0% / ");
  });

  it("says nothing under an undiscounted line", () => {
    const clean = render({
      lines: [line({ title: "WASH & VACUUM", unitInclCents: 71500, fullInclCents: 71500, totalInclCents: 71500 })],
      subtotalInclCents: 71500, discountInclCents: 0, totalCents: 71500, vatCents: 9326,
    });
    expect(clean).not.toContain("Initial price");
    expect(clean).not.toContain("Discount");
  });
});

describe("emphasis matches the reference", () => {
  const html = render();

  it("bolds the sale's identity, the items, the totals, the tender and the thanks", () => {
    for (const t of ["No. 11", "NUM VAT INVOICE", "Bill 1-N00000028", "HANGING CAR DIFFU", "Total:", "excl. VAT :", "CARD : ", "Thank you for visiting."]) {
      expect(styleAround(html, t), t).toMatch(/font-weight:(700|800)/);
    }
  });

  it("keeps the column header, the sub-lines, the subtotals and the tax block light", () => {
    for (const t of ["Designation", "Initial price", "Subtotal :", "Discount :", "TAUX NORMAL"]) {
      expect(styleAround(html, t), t).not.toMatch(/font-weight:(700|800)/);
    }
  });
});

describe("tender rows", () => {
  it("leads with how many legs of that method were taken", () => {
    const html = render({
      payments: [tender({ method: "CASH", count: 2, amountCents: 80000 }), tender({ method: "CARD", count: 1, amountCents: 75045 })],
    });
    // The gap is a non-breaking space in the markup — match any run of whitespace.
    expect(html).toMatch(/2\s+CASH : /);
    expect(html).toContain("800.00Rs");
    expect(html).toMatch(/1\s+CARD : /);
    expect(html).toContain("750.45Rs");
  });

  it("gives a reversal its own row instead of netting it away", () => {
    const html = render({
      payments: [tender({ method: "CASH", count: 1, amountCents: 80000 }), tender({ method: "CASH", amountCents: -80000, isReversal: true })],
    });
    expect(html).toContain("CASH REVERSED : ");
    expect(html).toContain("-800.00Rs");
  });

  it("says ON ACCOUNT when nothing was tendered", () => {
    expect(render({ payments: [] })).toContain("ON ACCOUNT : ");
  });

  it("never claims payment on a quote or a dead invoice", () => {
    expect(render({ isInvoice: false })).not.toContain("CARD : ");
    expect(render({ voided: true })).not.toContain("CARD : ");
  });

  it("stamps a void invoice", () => {
    expect(render({ voided: true })).toContain(">VOID<");
  });
});

describe("points earned and the running balance (rule 4, 2026-08-10)", () => {
  it("states what this sale earned and the balance after it, when a customer is named", () => {
    const html = render({ pointsEarned: 11, pointsBalanceAfter: 42 });
    expect(html).toContain("Points earned :");
    expect(html).toContain("11 pts");
    expect(html).toContain("Points balance :");
    expect(html).toContain("42 pts");
  });

  it("prints neither line for an anonymous walk-in", () => {
    const html = render({ pointsEarned: null, pointsBalanceAfter: null });
    expect(html).not.toContain("Points earned");
    expect(html).not.toContain("Points balance");
  });

  it("never claims points on a quote or a dead invoice", () => {
    expect(render({ pointsEarned: 11, pointsBalanceAfter: 42, isInvoice: false })).not.toContain("Points earned");
    expect(render({ pointsEarned: 11, pointsBalanceAfter: 42, voided: true })).not.toContain("Points earned");
  });
});

describe("a business client's fiscal identity", () => {
  it("prints the client's BRN and VAT number directly under their name", () => {
    const html = render({ customerName: "ACME Ltd", customerBrn: "C12345678", customerVatNo: "VAT20345678" });
    // Under the customer, above the items — the buyer's block, not the issuer's footer.
    const seen = order(html, "Customer : ACME Ltd", "BRN : C12345678", "VAT No : 20345678", "Designation");
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("strips a leading VAT prefix from the client's number, like the footer does", () => {
    const html = render({ customerVatNo: "VAT20345678" });
    expect(html).toContain("VAT No : 20345678");
    expect(html).not.toContain("VAT No : VAT20345678");
  });

  it("omits both lines for a walk-in or an individual who carries neither", () => {
    // The footer still carries the ISSUER's own BRN/VAT — scope the check to the buyer's
    // identity block, between their name and the items.
    const html = render({ customerName: "Jane Doe", customerBrn: "", customerVatNo: "" });
    const block = html.slice(html.indexOf("Customer : Jane Doe"), html.indexOf("Designation"));
    expect(block).not.toContain("BRN");
    expect(block).not.toContain("VAT");
  });
});

describe("lines the slip must never print", () => {
  it("claims no fiscal certification we do not hold, and no other vendor's build signature", () => {
    // NF525 is a FRENCH fiscal-software certification; the rest of that footer line on the
    // reference is Cashmag's own build signature.
    const html = render().toUpperCase();
    expect(html).not.toMatch(/NF\s*525/);
    expect(html).not.toContain("CASHMAG");
  });

  it("omits Appareil rather than inventing a terminal for a web-rung sale", () => {
    expect(render({ terminalNo: null })).not.toContain("Appareil");
  });

  it("omits the Bill line for a row that predates bill_no", () => {
    expect(render({ billLabel: null })).not.toContain("Bill ");
  });

  it("omits No. for a sale that never touched a till", () => {
    expect(render({ ticketNo: null })).not.toContain("No. ");
  });

  it("prints the studio name only when there is no logo to print above it", () => {
    expect(render()).toContain("CARFECTIONIST</div>");
    expect(render({ logoUrl: "https://example.test/logo.png" })).not.toContain("CARFECTIONIST</div>");
  });
});
