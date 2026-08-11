import { Cents, cents, roundHalfAwayFromZero } from './cents';
import type { DiscountKind, DocDiscount } from './totals';

/**
 * How much of a document may be discounted — the web mirror of
 * app.document_discount_limits and app.assert_discount_allowed (20260810000040).
 * The DATABASE is the authority and refuses at issue_document; this exists so the
 * builder can clamp an input and explain the limit before the cashier fills a
 * basket they will not be allowed to issue.
 *
 * Everything is VAT-INCLUSIVE cents, because that is the one unit a percentage
 * discount and a fixed "Rs X off" both share.
 *
 * The gross is derived the way the generated columns derive an UNDISCOUNTED
 * line — round(qty*unit) first, then its VAT — so an undiscounted document
 * reports exactly 0. Computing round(qty*unit*(1+rate/100)) instead drifts a
 * cent on fractional quantities and raises a phantom discount that would demand
 * a reason nobody owes.
 */

export type DiscountPolicy = 'none' | 'carwash' | 'free';

/** The DEFAULT carwash cap and per-kind fallbacks — the values these rules were
 *  hardcoded to before business_settings could carry them (20260812000010). Every
 *  function below takes the live values as optional arguments and falls back to
 *  these, so a caller that has not loaded the owner's settings behaves exactly as
 *  the shop did before the cap became editable. */
export const CARWASH_MAX_PCT = 5;

/** What an `inherit` line falls back to, by kind — mirrors the DB's
 *  default_policy_service / default_policy_goods. */
export interface PolicyDefaults {
  service: DiscountPolicy;
  goods: DiscountPolicy;
}
export const DEFAULT_POLICIES: PolicyDefaults = { service: 'none', goods: 'free' };

/** A cent of tolerance, matching app.assert_discount_allowed's 0.01. */
const TOLERANCE_CENTS = 1;

export interface AllowanceLineInput {
  qty: number;
  unitCents: number;            // VAT-exclusive unit price
  vatRatePct: number;
  policy: DiscountPolicy;
  discountKind?: DiscountKind;
  discountPct?: number;
  discountAmountCents?: number; // VAT-inclusive
}

export interface Allowance {
  ceilingCents: Cents;   // the most this document may be discounted
  freeCents: Cents;      // how much of that comes from unrestricted goods lines
  actualCents: Cents;    // what it carries, line + order discounts together
  overCeiling: boolean;  // needs the owner
  reasonRequired: boolean;
}

/**
 * The effective policy of a line. An explicit product policy wins; 'inherit'
 * defers to the kind. An unknown kind reads as a service, which is the safer
 * default — it withholds a discount rather than granting one.
 */
export function policyOf(
  productPolicy: string | null | undefined,
  effectiveKind: string | null | undefined,
  defaults: PolicyDefaults = DEFAULT_POLICIES,
): DiscountPolicy {
  if (productPolicy && productPolicy !== 'inherit') return productPolicy as DiscountPolicy;
  // The kind decides which fallback applies — the SAME split app.document_discount_limits
  // uses: a service (or an unknown/null kind) takes the service default; a product or
  // consumable takes the goods default.
  return effectiveKind === 'product' || effectiveKind === 'consumable' ? defaults.goods : defaults.service;
}

function grossInclCents(l: AllowanceLineInput): number {
  const excl = roundHalfAwayFromZero(l.qty * l.unitCents);
  return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100);
}

function netInclCents(l: AllowanceLineInput): number {
  const base = l.qty * l.unitCents;
  const excl = l.discountKind === 'amount'
    ? roundHalfAwayFromZero(Math.max(base - (l.discountAmountCents ?? 0) / (1 + l.vatRatePct / 100), 0))
    : roundHalfAwayFromZero(base * (1 - (l.discountPct ?? 0) / 100));
  return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100);
}

/** What a line's net comes to at a given percentage off, rounded as the DB rounds. */
function netInclAtPct(l: AllowanceLineInput, pct: number): number {
  const excl = roundHalfAwayFromZero(l.qty * l.unitCents * (1 - pct / 100));
  return excl + roundHalfAwayFromZero((excl * l.vatRatePct) / 100);
}

/**
 * The most a single line may be discounted, in VAT-inclusive cents.
 *
 * A carwash's allowance is what a 5% discount GENUINELY removes — not 5% of the
 * gross. The two differ by about a cent per line, because the discounted net and
 * its VAT are each rounded. Measuring it the other way made a 5% line exceed its
 * own ceiling by a cent: one line's tolerance hid that, two lines' did not, and a
 * customer with two cars was refused the discount the shop is expressly allowed
 * to give. See 20260811000060.
 */
export function lineAllowanceCents(l: AllowanceLineInput, carwashPct: number = CARWASH_MAX_PCT): number {
  const gross = grossInclCents(l);
  if (l.policy === 'free') return gross;
  if (l.policy === 'carwash') return Math.max(gross - netInclAtPct(l, carwashPct), 0);
  return 0;
}

export function computeAllowance(
  lines: AllowanceLineInput[],
  docDiscount: DocDiscount | null,
  approvedMaxCents?: number | null,
  carwashPct: number = CARWASH_MAX_PCT,
): Allowance {
  let ceiling = 0;
  let free = 0;
  let lineDisc = 0;
  let postLineGross = 0;

  for (const l of lines) {
    const gross = grossInclCents(l);
    ceiling += lineAllowanceCents(l, carwashPct);
    if (l.policy === 'free') free += gross;
    const net = netInclCents(l);
    lineDisc += Math.max(gross - net, 0);
    postLineGross += net;
  }

  const order = !docDiscount || docDiscount.value <= 0
    ? 0
    : docDiscount.kind === 'percent'
      ? Math.min(roundHalfAwayFromZero((postLineGross * docDiscount.value) / 100), postLineGross)
      : Math.min(docDiscount.value, postLineGross);

  const actual = lineDisc + order;
  const allowed = Math.max(ceiling, approvedMaxCents ?? 0);

  return {
    ceilingCents: cents(ceiling),
    freeCents: cents(free),
    actualCents: cents(actual),
    overCeiling: actual > allowed + TOLERANCE_CENTS,
    // An owner's approval carries its own reason, so it answers this too.
    reasonRequired: approvedMaxCents == null && actual > free + TOLERANCE_CENTS,
  };
}
