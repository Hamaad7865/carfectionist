import { describe, expect, it } from 'vitest';
import { computeAllowance, lineAllowanceCents, policyOf, type AllowanceLineInput } from './allowance';

// Rs 1,000 ex-VAT at 15% = Rs 1,150 inclusive = 115_000 cents.
const line = (over: Partial<AllowanceLineInput> = {}): AllowanceLineInput => ({
  qty: 1, unitCents: 100_000, vatRatePct: 15, policy: 'free',
  discountKind: 'percent', discountPct: 0, discountAmountCents: 0, ...over,
});

describe('policyOf', () => {
  it('lets an explicit product policy win', () => {
    expect(policyOf('carwash', 'service')).toBe('carwash');
    expect(policyOf('free', 'service')).toBe('free');
  });

  it('derives from the kind when the product says inherit', () => {
    expect(policyOf('inherit', 'service')).toBe('none');
    expect(policyOf('inherit', 'product')).toBe('free');
  });

  it('treats an unknown kind as a service — the safer default', () => {
    expect(policyOf(null, null)).toBe('none');
  });

  it('falls back to the configured per-kind default', () => {
    expect(policyOf(null, 'service', { service: 'free', goods: 'none' })).toBe('free');
    expect(policyOf(null, 'product', { service: 'free', goods: 'none' })).toBe('none');
  });
});

describe('lineAllowanceCents', () => {
  it('gives a service nothing', () => {
    expect(lineAllowanceCents(line({ policy: 'none' }))).toBe(0);
  });

  it('gives a carwash 5% of its gross', () => {
    expect(lineAllowanceCents(line({ policy: 'carwash' }))).toBe(5_750);
  });

  it('gives goods the whole line', () => {
    expect(lineAllowanceCents(line())).toBe(115_000);
  });

  it('widens a carwash allowance when the cap is raised', () => {
    // At the default 5% cap this line allows 5_750; at 10% it allows 11_500 —
    // the same figures the DB probe computes (57.50 / 115.00 rupees).
    expect(lineAllowanceCents(line({ policy: 'carwash' }))).toBe(5_750);
    expect(lineAllowanceCents(line({ policy: 'carwash' }), 10)).toBe(11_500);
  });
});

describe('computeAllowance', () => {
  it('sums a mixed document', () => {
    expect(computeAllowance([line({ policy: 'none' }), line()], null).ceilingCents).toBe(115_000);
  });

  it('does not count a carwash allowance as free', () => {
    expect(computeAllowance([line({ policy: 'carwash' })], null).freeCents).toBe(0);
  });

  it('reports exactly zero on an undiscounted document', () => {
    expect(computeAllowance([line({ qty: 3 })], null).actualCents).toBe(0);
  });

  it('reports zero where a naive gross derivation would drift', () => {
    // qty 1.25 at Rs 567.17. Two-step rounding gives Rs 815.30; the naive
    // round(qty*unit*1.15) gives 815.31 — a phantom cent on a line carrying
    // no discount at all, which would then demand a reason for it.
    expect(computeAllowance([line({ qty: 1.25, unitCents: 56_717 })], null).actualCents).toBe(0);
  });

  it('counts line and order discounts together', () => {
    const r = computeAllowance(
      [line({ discountKind: 'amount', discountAmountCents: 10_000 })],
      { kind: 'amount', value: 5_000 },
    );
    expect(r.actualCents).toBe(15_000);
  });

  it('knows when a reason is owed', () => {
    const r = computeAllowance([line({ policy: 'carwash', discountPct: 5 })], null);
    expect(r.reasonRequired).toBe(true);
    expect(r.overCeiling).toBe(false);
  });

  it('does not ask for a reason when goods cover the discount', () => {
    expect(computeAllowance([line({ discountPct: 5 })], null).reasonRequired).toBe(false);
  });

  it('lets a carwash at exactly 5% sit on its ceiling, at any line count', () => {
    // The bug this pins: the allowance used to be 5% OF THE GROSS, a cent less
    // than what a 5% discount actually removes once the discounted net and its
    // VAT are each rounded. One line hid inside the guard's 1-cent tolerance;
    // two did not — 135.02 against 135.00 — so a customer with two cars was
    // refused the discount the shop is expressly allowed to give.
    // TOUCHLESS FOAM WASH SEDAN: Rs 1,173.91 net, Rs 1,350.00 gross.
    const wash = () => line({ policy: 'carwash', unitCents: 117_391, discountPct: 5 });
    for (const n of [1, 2, 3, 5]) {
      const r = computeAllowance(Array.from({ length: n }, wash), null);
      expect(r.actualCents).toBe(r.ceilingCents);
      expect(r.overCeiling).toBe(false);
    }
  });

  it('still refuses a carwash above 5%', () => {
    expect(computeAllowance([line({ policy: 'carwash', unitCents: 117_391, discountPct: 6 })], null).overCeiling).toBe(true);
  });

  it('flags a discount past the ceiling', () => {
    expect(computeAllowance([line({ policy: 'none', discountPct: 10 })], null).overCeiling).toBe(true);
  });

  it('lets an owner-approved figure raise the ceiling, and no further', () => {
    const over = [line({ policy: 'none', discountPct: 10 })];
    expect(computeAllowance(over, null, 11_500).overCeiling).toBe(false);
    expect(computeAllowance(over, null, 11_000).overCeiling).toBe(true);
  });

  it('does not ask for a reason once an owner has approved', () => {
    expect(computeAllowance([line({ policy: 'carwash', discountPct: 5 })], null, 5_750).reasonRequired).toBe(false);
  });

  it('honours a raised carwash cap', () => {
    expect(computeAllowance([line({ policy: 'carwash' })], null, null, 10).ceilingCents).toBe(11_500);
  });
});
