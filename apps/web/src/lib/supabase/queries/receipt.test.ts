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

describe("tender rows: one dated leg each, never a reversal netted away", () => {
  // The tablet's own fixture (core/hardware ReceiptTextTest): a deposit taken at 22:41 and the
  // balance at 22:43 print as two dated CASH rows, never a collapsed "2   CASH".
  it("itemises every leg with its time, oldest first, on a split", () => {
    const t = receiptTenders([
      { id: "dep", method: "cash", amount: 412.00, received_at: "2026-09-10T18:41:00Z" },
      { id: "bal", method: "cash", amount: 1238.00, received_at: "2026-09-10T18:43:00Z" },
    ]);
    expect(t).toEqual([
      { method: "CASH", count: 1, amountCents: 41200, isReversal: false, stamp: "10/09 22:41" },
      { method: "CASH", count: 1, amountCents: 123800, isReversal: false, stamp: "10/09 22:43" },
    ]);
    // Never the old method-collapsed row.
    expect(t.some((x) => x.count > 1)).toBe(false);
  });

  it("stamps each method of a mixed split — the real INV-0255 (Juice now, Card next day)", () => {
    // The document that prompted this: 2000 paid by Juice at the counter, then the 2400 balance
    // settled by card the NEXT DAY. The stamp is what tells the two apart — the header time up
    // top is the sale's, not the balance leg's.
    const t = receiptTenders([
      { id: "j", method: "juice", amount: 2000.00, received_at: "2026-09-11T10:51:21.447831+00:00" },
      { id: "c", method: "card", amount: 2400.00, received_at: "2026-09-12T06:56:14.001938+00:00" },
    ]);
    expect(t).toEqual([
      { method: "JUICE", count: 1, amountCents: 200000, isReversal: false, stamp: "11/09 14:51" },
      { method: "CARD", count: 1, amountCents: 240000, isReversal: false, stamp: "12/09 10:56" },
    ]);
  });

  it("orders legs by the raw timestamp, not the dd/MM label", () => {
    // A December leg belongs before a January one; the "dd/MM" text alone would sort 03/01
    // ahead of 05/12. Passed newest-first to prove the sort, not the input order.
    const t = receiptTenders([
      { id: "jan", method: "cash", amount: 100.00, received_at: "2027-01-03T06:00:00Z" },
      { id: "dec", method: "cash", amount: 200.00, received_at: "2026-12-05T06:00:00Z" },
    ]);
    expect(t.map((x) => x.stamp)).toEqual(["05/12 10:00", "03/01 10:00"]);
    expect(t.map((x) => x.amountCents)).toEqual([20000, 10000]);
  });

  it("shows no time on a lone payment — it was taken at the sale time up top", () => {
    // Set-level gate: a single payment row carries a null stamp even with a timestamp of its
    // own, matching the tablet's `d.payments.size > 1` render gate.
    const t = receiptTenders([{ id: "p1", method: "card", amount: 1550.45, received_at: "2026-07-25T08:08:44Z" }]);
    expect(t).toEqual([{ method: "CARD", count: 1, amountCents: 155045, isReversal: false, stamp: null }]);
  });

  it("gives a reversal its own undated row while the live leg keeps its time", () => {
    // Netting made a refunded Rs 800 cash tender print as "1 CASH : 0.00Rs" — a row nobody
    // could question, because the refund had vanished into it.
    const t = receiptTenders([
      { id: "p1", method: "cash", amount: 800.00, received_at: "2026-09-10T18:41:00Z", reverses_payment_id: null },
      { id: "r1", method: "cash", amount: -800.00, reverses_payment_id: "p1" },
    ]);
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ method: "CASH", count: 1, amountCents: 80000, isReversal: false, stamp: "10/09 22:41" });
    // The reversal keeps its full value, stated not subtracted, and carries no time of its own.
    expect(t[1]).toEqual({ method: "CASH", count: 1, amountCents: -80000, isReversal: true, stamp: null });
  });

  it("names methods the way the slip prints them", () => {
    const t = receiptTenders([{ method: "bank_transfer", amount: 100 }, { method: "juice", amount: 50 }]);
    expect(t.map((x) => x.method)).toEqual(["BANK TRANSFER", "JUICE"]);
  });

  it("returns nothing for an unpaid bill, which is what makes the slip say ON ACCOUNT", () => {
    expect(receiptTenders([])).toEqual([]);
  });

  // The row must state what the customer HANDED OVER, not what stayed in the till — an
  // Rs 825 bill paid with a Rs 1000 note reads "1  CASH : 1000.00Rs" with "Change : 175.00"
  // underneath, matching the tablet slip (core/data/SaleReceipt.kt). Web used to print 825.
  it("folds change back into the leg so it states what was handed over", () => {
    const t = receiptTenders([{ id: "p1", method: "cash", amount: 825.0, change_given: 175.0 }]);
    expect(t).toEqual([{ method: "CASH", count: 1, amountCents: 100000, isReversal: false, stamp: null }]);
  });

  it("folds each leg's own change in across a split, to the true amount tendered", () => {
    // Two cash legs, all the change handed back on the second — the two rows still total the
    // real Rs 7000 that crossed the counter.
    const t = receiptTenders([
      { id: "a", method: "cash", amount: 4000.01, change_given: 0, received_at: "2026-09-10T18:41:00Z" },
      { id: "b", method: "cash", amount: 2159.98, change_given: 840.01, received_at: "2026-09-10T18:43:00Z" },
    ]);
    expect(t.map((x) => x.amountCents)).toEqual([400001, 299999]);
    expect(t.reduce((s, x) => s + x.amountCents, 0)).toBe(700000);
  });

  it("does not fold change into a reversed cash leg", () => {
    // The leg was reversed, so the caller suppresses its Change line too — the row must show
    // only what was kept, or the paper reads 1000 out with nothing to explain the 175.
    const t = receiptTenders([
      { id: "p1", method: "cash", amount: 825.0, change_given: 175.0, reverses_payment_id: null },
      { id: "r1", method: "cash", amount: -825.0, change_given: null, reverses_payment_id: "p1" },
    ]);
    expect(t[0]).toEqual({ method: "CASH", count: 1, amountCents: 82500, isReversal: false, stamp: null });
    expect(t[1]).toEqual({ method: "CASH", count: 1, amountCents: -82500, isReversal: true, stamp: null });
  });
});

describe("one slip renderer, not two", () => {
  it("keeps ReceiptThermal deleted — it was a second, unmaintained copy of this layout", () => {
    // What the slip does and does not PRINT is asserted on the rendered markup, in
    // components/pdf/ReceiptCard.test.tsx.
    expect(existsSync(fileURLToPath(new URL("../../../components/pdf/ReceiptThermal.tsx", import.meta.url)))).toBe(false);
  });
});
