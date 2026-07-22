import { describe, it, expect } from "vitest";
import { grossCents, netFromGrossCents, unitCentsFromTyped, presentLine, presentTotals } from "./index";

const VAT = 15;

describe("typed shelf prices are stored one way", () => {
  // The defect this pins: the builder displayed grossCents(unitCents) while committing
  // netFromGrossCents(typed), and its re-sync effect fed the round trip back into the input.
  // Typing "1500" became "149.990" and stored 130.43. 3,212 of 9,999 whole-rupee entries
  // committed a wrong price.
  it("stores exactly what one conversion of the typed figure gives, for every whole rupee", () => {
    for (let rupees = 1; rupees <= 9999; rupees++) {
      const typed = rupees * 100;
      expect(unitCentsFromTyped(typed, VAT, true)).toBe(Math.round(typed / 1.15));
    }
  });

  it("is idempotent — retyping the same figure can never drift the stored price", () => {
    for (let rupees = 1; rupees <= 9999; rupees++) {
      const once = unitCentsFromTyped(rupees * 100, VAT, true);
      // What the OLD wiring did on every keystroke: re-derive the box from the stored net, then
      // convert that back. This is the step that corrupted prices.
      expect(unitCentsFromTyped(grossCents(once, VAT), VAT, true)).toBe(once);
    }
  });

  it("proves the round trip really is lossy, so the one-way rule is load-bearing", () => {
    let unreachable = 0;
    for (let c = 1; c <= 200000; c++) if (grossCents(netFromGrossCents(c, VAT), VAT) !== c) unreachable++;
    // ~13% of gross figures have no net that grosses back to them. If this ever reaches zero the
    // arithmetic changed and the one-way rule could be revisited; until then it must stay.
    expect(unreachable).toBeGreaterThan(20000);
    // Rs 380.00 has no net preimage: 33043 grosses to 379.99, 33044 to 380.01.
    expect(grossCents(netFromGrossCents(38000, VAT), VAT)).not.toBe(38000);
  });

  it("passes the typed figure straight through on a net-quoting shop", () => {
    expect(unitCentsFromTyped(150000, VAT, false)).toBe(150000);
  });
});

describe("one document, one set of figures", () => {
  // The back-office screen and the PDF each derived this and disagreed: the same invoice read
  // Rate 660.00 / Amount 626.99 on the PDF and 573.91 / 545.21 on screen.
  const line = { unit_price: 573.91, line_total_excl: 545.21, line_vat: 81.78, vat_rate: 15 };

  it("states the shelf price the customer was quoted", () => {
    expect(presentLine(line, true)).toEqual({ rateCents: 66000, amountCents: 62699 });
  });

  it("states the stored net when the shop quotes net", () => {
    expect(presentLine(line, false)).toEqual({ rateCents: 57391, amountCents: 54521 });
  });

  it("foots: Subtotal is summed from the very lines shown, and Discount is the gap to TOTAL", () => {
    const lines = [line, { unit_price: 621.74, line_total_excl: 621.74, line_vat: 93.26, vat_rate: 15 }];
    const t = presentTotals(lines, 130000, true); // Rs 1,341.99 of lines, billed at Rs 1,300.00
    expect(t.subtotalCents).toBe(62699 + 71500);
    expect(t.discountCents).toBe(4199);
    expect(t.subtotalCents - (t.discountCents ?? 0)).toBe(130000);
  });

  it("shows no discount row when nothing was discounted", () => {
    expect(presentTotals([line], 62699, true).discountCents).toBeUndefined();
  });
});
