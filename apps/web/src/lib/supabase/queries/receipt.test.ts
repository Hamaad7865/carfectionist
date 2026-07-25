import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  receiptLineOf, receiptTotals, terminalNoOf, billReference, receiptTenders,
  type ReceiptLine, type ReceiptLineRow,
} from "./receipt";
import { grossCents, netFromGrossCents } from "@/lib/money";

/**
 * The slip's totals, pinned against the studio's OWN receipt (25-07-2026, ticket No. 11,
 * INV-0031) — the layout the owner asked us to match, and the same paper the tablet's
 * ReceiptTextTest pins. The two renderers must state one document, not two.
 *
 *   line disc  = UP × pct/100       608.30 = 1738.00 × 0.35
 *   line total = UP − disc         1129.70 = 1738.00 − 608.30
 *   Subtotal   = Σ(full price)     2233.00 = 1738.00 + 495.00
 *   Discount   = Σ(saved)           682.55 = 608.30 + 74.25
 *   Total      = Subtotal − Disc   1550.45
 *   excl. VAT  = Total / 1.15      1348.22   (prices are VAT-INCLUSIVE)
 *   VAT        = Total − excl       202.23
 */

const TOTAL = 155045;
const VAT_TOTAL = 20223;
const EXCL_TOTAL = 134822;

/** A slip row as the reference paper states it — full price, charged price, saving. */
const refLine = (over: Partial<ReceiptLine>): ReceiptLine => ({
  qty: 1, title: "ITEM", unitInclCents: 0, totalInclCents: 0, fullInclCents: 0,
  discountInclCents: 0, discountPct: 0, discountLabel: null,
  unitExclCents: 0, totalExclCents: 0, vatRate: 15,
  ...over,
});

describe("the reference sale's totals block", () => {
  // The figures exactly as the owner's paper states them.
  const lines = [
    refLine({ title: "HANGING CAR DIFFU", unitInclCents: 173800, fullInclCents: 173800, totalInclCents: 112970, discountInclCents: 60830, discountPct: 35 }),
    refLine({ title: "SAVORE CARD AIR FR", unitInclCents: 49500, fullInclCents: 49500, totalInclCents: 42075, discountInclCents: 7425, discountPct: 15 }),
  ];
  const t = receiptTotals(lines, TOTAL);

  it("sums Subtotal from the lines at FULL price, not the discounted ones", () => {
    // The defect this pins: subtotalInclCents used to be Σ of the ALREADY-DISCOUNTED line
    // amounts, so this sale printed "Subtotal 1550.45 / Discount 0.00" and the customer
    // never saw the 682.55 they had just saved.
    expect(t.subtotalInclCents).toBe(223300);
    expect(t.subtotalInclCents).not.toBe(lines.reduce((s, l) => s + l.totalInclCents, 0));
  });

  it("states the Discount as the gap to the document's own TOTAL", () => {
    expect(t.discountInclCents).toBe(68255);
  });

  it("foots: Subtotal − Discount = Total, always", () => {
    expect(t.subtotalInclCents - t.discountInclCents).toBe(TOTAL);
    expect(TOTAL - VAT_TOTAL).toBe(EXCL_TOTAL); // "excl. VAT : 1348.22Rs"
  });

  it("absorbs a whole-basket discount the lines know nothing about", () => {
    // Two undiscounted lines billed at less than their sum: the rule is representation-agnostic,
    // so the block still foots without any line carrying a discount of its own.
    const flat = [
      refLine({ unitInclCents: 100000, fullInclCents: 100000, totalInclCents: 100000 }),
      refLine({ unitInclCents: 50000, fullInclCents: 50000, totalInclCents: 50000 }),
    ];
    const b = receiptTotals(flat, 135000);
    expect(b.subtotalInclCents).toBe(150000);
    expect(b.discountInclCents).toBe(15000);
    expect(b.subtotalInclCents - b.discountInclCents).toBe(135000);
  });

  it("prints no Discount row when nothing was discounted", () => {
    const none = [refLine({ unitInclCents: 71500, fullInclCents: 71500, totalInclCents: 71500 })];
    expect(receiptTotals(none, 71500).discountInclCents).toBe(0);
  });
});

describe("the same sale as our ledger actually stores it", () => {
  // Money is stored NET (document_lines.unit_price ex-VAT; the DB's generated columns add VAT),
  // so these are the rows a Rs 1,738.00 and a Rs 495.00 shelf price really produce.
  const hanging: ReceiptLineRow = {
    title: "HANGING CAR DIFFU", qty: 1, unit_price: 1511.30, line_total_excl: 982.35, line_vat: 147.35,
    vat_rate: 15, discount_kind: "percent", discount_pct: 35, discount_amount: 0,
  };
  const savore: ReceiptLineRow = {
    title: "SAVORE CARD AIR FR", qty: 1, unit_price: 430.43, line_total_excl: 365.87, line_vat: 54.88,
    vat_rate: 15, discount_kind: "percent", discount_pct: 15, discount_amount: 0,
  };

  it("puts the FULL unit price in UP and the charged amount in Total", () => {
    const l = receiptLineOf(hanging);
    expect(l.unitInclCents).toBe(173800);  // "1738.00" — NOT the discounted 1129.70
    expect(l.totalInclCents).toBe(112970); // "1129.70"
    expect(l.fullInclCents).toBe(173800);  // "Initial price : 1738.00"
    expect(l.discountInclCents).toBe(60830); // "Discount 35.0% / 608.30"
    expect(l.discountPct).toBe(35);
  });

  it("still foots on the real rows, and the document's own money is untouched", () => {
    const lines = [hanging, savore].map(receiptLineOf);
    const t = receiptTotals(lines, TOTAL);
    expect(t.subtotalInclCents - t.discountInclCents).toBe(TOTAL);
    // The ledger's figures, straight off the document — never recomputed here.
    expect(lines.reduce((s, l) => s + l.totalExclCents, 0)).toBe(EXCL_TOTAL);
    expect(lines.reduce((s, l) => s + l.totalInclCents, 0)).toBe(TOTAL);
  });

  it("quotes the shelf price its stored net really makes — Rs 495.00 has no net preimage", () => {
    // The one place we cannot equal the reference paper: at 15% VAT nothing grosses to 49500
    // (43043 → 494.99, 43044 → 495.01), the same hole document-view.test.ts pins for Rs 380.00.
    // We print what our net actually makes — as the tablet does, and as the invoice PDF's Rate
    // column does — rather than a figure no stored price can produce.
    expect(grossCents(netFromGrossCents(49500, 15), 15)).not.toBe(49500);
    const l = receiptLineOf(savore);
    expect(l.unitInclCents).toBe(49499);
    expect(l.fullInclCents).toBe(49499);
    expect(l.discountInclCents).toBe(7424);
    expect(l.totalInclCents).toBe(42075); // the charged figure is exact, and it is what is owed
  });
});

describe("INV-0028 — the reference sale as it really sits in the ledger", () => {
  // Transcribed verbatim from production (document_lines for INV-0028). It rings up the same
  // two items as the owner's paper, and it exercises BOTH discount shapes at once: a cash
  // "Rs 609.00 off" and a 15% one. total_incl 1549.74 / vat_total 202.14.
  const rows: ReceiptLineRow[] = [
    { title: "Car Diffuser BOSS", qty: 1, unit_price: 1511.30, line_total_excl: 981.73, line_vat: 147.26, vat_rate: 15, discount_kind: "amount", discount_pct: 0, discount_amount: 609.00 },
    { title: "Card Savore", qty: 1, unit_price: 430.43, line_total_excl: 365.87, line_vat: 54.88, vat_rate: 15, discount_kind: "percent", discount_pct: 15, discount_amount: 0 },
  ];
  const lines = rows.map(receiptLineOf);
  const t = receiptTotals(lines, 154974);

  it("foots line by line: UP − Discount = Total on every row", () => {
    for (const l of lines) expect(l.fullInclCents - l.discountInclCents).toBe(l.totalInclCents);
  });

  it("foots in the totals block, and the block equals the sum of the line savings", () => {
    expect(t.subtotalInclCents).toBe(223299); // 1738.00 + 494.99
    expect(t.discountInclCents).toBe(68325);  // 609.01 + 74.24
    expect(t.subtotalInclCents - t.discountInclCents).toBe(154974);
    expect(lines.reduce((s, l) => s + l.discountInclCents, 0)).toBe(t.discountInclCents);
  });

  it("prints a cash discount as what it really took off, not the figure that was typed", () => {
    // Rs 609.00 is stored INCLUSIVE and reaches the ledger via net (÷1.15, then VAT back on),
    // so the line actually saved 609.01. Printing the typed 609.00 beside a 1128.99 total
    // would leave a cent the customer can see and nobody can explain.
    expect(lines[0].discountInclCents).toBe(60901);
    expect(lines[0].discountPct).toBe(0); // → "Discount : 609.01", never "Discount 0.0% / …"
    expect(lines[0].discountLabel).toBe("Rs 609.00 off");
  });
});

describe("a line's discount comes off the STORED fields, never off full − charged", () => {
  // The trap this guards: VAT rounds once per LINE, so `qty × unit − charged` is a cent or two
  // adrift on plenty of perfectly UNdiscounted lines and would print a phantom
  // "Initial price / Discount 0.01" beneath items nobody discounted.
  const wash: ReceiptLineRow = {
    title: "WASH & VACUUM", qty: 1, unit_price: 621.74, line_total_excl: 621.74, line_vat: 93.26,
    vat_rate: 15, discount_kind: "percent", discount_pct: 0, discount_amount: 0,
  };

  it("says nothing at all under a line that was never discounted", () => {
    const l = receiptLineOf(wash);
    expect(l.discountInclCents).toBe(0);
    expect(l.discountLabel).toBeNull();
    expect(l.fullInclCents).toBe(l.totalInclCents); // no "Initial price" row to contradict it
  });

  it("survives the discount columns being absent altogether (legacy rows)", () => {
    const l = receiptLineOf({ ...wash, discount_kind: null, discount_pct: null, discount_amount: null });
    expect(l.discountInclCents).toBe(0);
    expect(l.discountLabel).toBeNull();
  });

  it("invents no discount on any whole-rupee shelf price, and never breaks the footing", () => {
    for (let rupees = 1; rupees <= 2000; rupees++) {
      const net = netFromGrossCents(rupees * 100, 15);
      const vat = grossCents(net, 15) - net;
      const l = receiptLineOf({
        title: "ITEM", qty: 1, unit_price: net / 100, line_total_excl: net / 100, line_vat: vat / 100,
        vat_rate: 15, discount_kind: "percent", discount_pct: 0, discount_amount: 0,
      });
      expect(l.discountInclCents).toBe(0);
      expect(receiptTotals([l], l.totalInclCents).discountInclCents).toBe(0);
    }
  });

  it("names a cash discount by its amount and keeps its percent column empty", () => {
    const l = receiptLineOf({
      title: "ITEM", qty: 1, unit_price: 1511.30, line_total_excl: 1011.30, line_vat: 151.70,
      vat_rate: 15, discount_kind: "amount", discount_pct: 0, discount_amount: 575.00,
    });
    expect(l.discountLabel).toBe("Rs 575.00 off");
    expect(l.discountPct).toBe(0); // "Discount : <amount>", never "Discount 0.0% / …"
    expect(l.discountInclCents).toBeGreaterThan(0);
  });
});

describe("Appareil — the terminal is an ordinal, never a device code", () => {
  // Production, `devices` ordered by first_seen with the retired ones left out. The two inactive
  // tablets (TAB-68A1, first seen BEFORE both live ones, and TAB-DF93) must not consume numbers,
  // or the live tablets would read 2 and 3 while the tablet itself prints 1 and 2.
  const active = ["TAB-84A1", "TAB-66D2"];

  it("numbers the active tablets oldest-first", () => {
    expect(terminalNoOf(active, "TAB-84A1")).toBe(1);
    expect(terminalNoOf(active, "TAB-66D2")).toBe(2);
  });

  it("prints nothing for a web-rung sale rather than inventing a terminal", () => {
    // The web opens its own tills as 'back-office', which is not a registered device.
    expect(terminalNoOf(active, "back-office")).toBeNull();
    expect(terminalNoOf(active, null)).toBeNull();
    expect(terminalNoOf(active, "TAB-68A1")).toBeNull(); // retired — not a live terminal
    expect(terminalNoOf([], "TAB-84A1")).toBeNull();     // registry unreadable
  });
});

describe("Bill — the internal order reference", () => {
  it("formats as <terminal>-N<8 digits>", () => {
    expect(billReference(28, 1)).toBe("Bill 1-N00000028");
    expect(billReference(3210, 2)).toBe("Bill 2-N00003210");
    expect(billReference(123456789, 1)).toBe("Bill 1-N123456789"); // never truncates the reference
  });

  it("falls back to terminal 1 when the terminal is unknown", () => {
    // Unlike the Appareil line, the Bill reference still prints — it identifies the order.
    expect(billReference(28, null)).toBe("Bill 1-N00000028");
  });

  it("prints no line at all for a row that predates bill_no", () => {
    expect(billReference(null, 1)).toBeNull();
    expect(billReference(undefined, 1)).toBeNull();
  });
});

describe("tender rows count the legs and never net a reversal away", () => {
  it("groups by method and leads with how many legs of that kind were taken", () => {
    const t = receiptTenders([
      { method: "cash", amount: 500.00 },
      { method: "cash", amount: 300.00 },
      { method: "card", amount: 750.45 },
    ]);
    expect(t).toEqual([
      { method: "CASH", count: 2, amountCents: 80000, isReversal: false },
      { method: "CARD", count: 1, amountCents: 75045, isReversal: false },
    ]);
  });

  it("gives a reversal its own row instead of shrinking the tender it undoes", () => {
    // Netting made a refunded Rs 800 cash tender print as "1 CASH : 0.00Rs" — a row nobody
    // could question, because the refund had vanished into it.
    const t = receiptTenders([
      { method: "cash", amount: 800.00, reverses_payment_id: null },
      { method: "cash", amount: -800.00, reverses_payment_id: "p1" },
    ]);
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ method: "CASH", count: 1, amountCents: 80000, isReversal: false });
    expect(t[1]).toEqual({ method: "CASH", count: 1, amountCents: -80000, isReversal: true });
    // The original leg keeps its full value — the reversal is stated, not subtracted.
    expect(t[0].amountCents).toBe(80000);
  });

  it("counts only real legs, so a reversal never inflates a group's count", () => {
    const t = receiptTenders([
      { method: "cash", amount: 500.00 },
      { method: "cash", amount: 300.00 },
      { method: "cash", amount: -300.00, reverses_payment_id: "p2" },
    ]);
    expect(t[0]).toEqual({ method: "CASH", count: 2, amountCents: 80000, isReversal: false });
  });

  it("names methods the way the slip prints them", () => {
    const t = receiptTenders([{ method: "bank_transfer", amount: 100 }, { method: "juice", amount: 50 }]);
    expect(t.map((x) => x.method)).toEqual(["BANK TRANSFER", "JUICE"]);
  });

  it("returns nothing for an unpaid bill, which is what makes the slip say ON ACCOUNT", () => {
    expect(receiptTenders([])).toEqual([]);
  });
});

describe("one slip renderer, not two", () => {
  it("keeps ReceiptThermal deleted — it was a second, unmaintained copy of this layout", () => {
    // What the slip does and does not PRINT is asserted on the rendered markup, in
    // components/pdf/ReceiptCard.test.tsx.
    expect(existsSync(fileURLToPath(new URL("../../../components/pdf/ReceiptThermal.tsx", import.meta.url)))).toBe(false);
  });
});
