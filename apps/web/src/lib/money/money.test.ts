import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { computeTotals, type TotalsLineInput } from './totals';
import { formatMUR } from './format';
import { parseMoneyInput } from './parse';
import { roundHalfAwayFromZero, rupeesToCents } from './cents';
import { amountInWordsMUR } from '../number-to-words';

const vectorsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../docs/vat-test-vectors.json',
);
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as {
  cases: {
    name: string;
    lines: TotalsLineInput[];
    expect: { subtotalCents: number; vatCents: number; totalCents: number };
    expectWords?: string;
  }[];
};

describe('computeTotals — shared VAT vectors (docs/vat-test-vectors.json)', () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const t = computeTotals(c.lines);
      expect(t.subtotalCents).toBe(c.expect.subtotalCents);
      expect(t.vatCents).toBe(c.expect.vatCents);
      expect(t.totalCents).toBe(c.expect.totalCents);
      if (c.expectWords) {
        expect(amountInWordsMUR(t.totalCents)).toBe(c.expectWords);
      }
    });
  }
});

describe('price_includes_vat — the typed price IS the price (20260812000020)', () => {
  // Fixtures identical to scripts/_verify-typed-price.mjs and MoneyTest.kt, so all
  // three engines are held to the same numbers.
  it('a flagged 1000 lands on exactly 1000 — the reported bug', () => {
    // Typing 1000 used to produce 1000.01: squashed to a 2dp net (869.57), re-grossed
    // a cent off. Flagged, the VAT is EXTRACTED (130.43) and the total is exact.
    const t = computeTotals([{ qty: 1, unitCents: 100_000, vatRatePct: 15, priceInclusive: true }]);
    expect(t.subtotalCents).toBe(86_957);
    expect(t.vatCents).toBe(13_043);
    expect(t.totalCents).toBe(100_000);
  });

  it('flagged qty and discounts stay exact', () => {
    const t = computeTotals([
      { qty: 2, unitCents: 100_000, vatRatePct: 15, discountPct: 10, priceInclusive: true },
      { qty: 1, unitCents: 100_000, vatRatePct: 15, discountKind: 'amount', discountAmountCents: 5_000, priceInclusive: true },
    ]);
    expect(t.totalCents).toBe(275_000); // 1800.00 + 950.00, both flat
  });

  it('an unflagged line still adds VAT on top — history unchanged', () => {
    const t = computeTotals([{ qty: 1, unitCents: 86_957, vatRatePct: 15 }]);
    expect(t.totalCents).toBe(100_001); // the old behaviour, byte-for-byte
  });
});

describe('the Diamondbrite Rs 88,780 case, spelled out', () => {
  const totals = computeTotals([
    { qty: 1, unitCents: 3200000, vatRatePct: 15 },
    { qty: 4, unitCents: 380000, vatRatePct: 15 },
    { qty: 1, unitCents: 3000000, vatRatePct: 15 },
  ]);
  it('subtotal is Rs 77,200.00', () => expect(formatMUR(totals.subtotalCents)).toBe('Rs 77,200.00'));
  it('VAT is Rs 11,580.00', () => expect(formatMUR(totals.vatCents)).toBe('Rs 11,580.00'));
  it('total is Rs 88,780.00', () => expect(formatMUR(totals.totalCents)).toBe('Rs 88,780.00'));
});

describe('formatMUR', () => {
  it.each([
    [3200000, 'Rs 32,000.00'],
    [8878000, 'Rs 88,780.00'],
    [180000000, 'Rs 1,800,000.00'],
    [100, 'Rs 1.00'],
    [99, 'Rs 0.99'],
    [0, 'Rs 0.00'],
    [-50000, 'Rs -500.00'],
  ])('%d → %s', (input, out) => expect(formatMUR(input)).toBe(out));
});

describe('parseMoneyInput', () => {
  it.each([
    ['Rs 32,000.00', 3200000],
    ['32000', 3200000],
    ['32,000', 3200000],
    ['3800.50', 380050],
    ['0', 0],
  ])('%s → %d cents', (input, out) => expect(parseMoneyInput(input)).toBe(out));

  it.each(['', '  ', 'abc', 'Rs', '-'])('rejects %j', (input) =>
    expect(parseMoneyInput(input)).toBeNull(),
  );
});

describe('rounding + conversion', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
  });
  it('rupeesToCents', () => {
    expect(rupeesToCents(32000)).toBe(3200000);
    expect(rupeesToCents(3800.5)).toBe(380050);
  });
});
