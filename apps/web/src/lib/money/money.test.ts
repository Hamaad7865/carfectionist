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
