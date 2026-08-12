import type { CounterProduct } from "@/lib/supabase/queries/counter";
import {
  CARWASH_MAX_PCT,
  computeAllowance,
  formatMUR,
  lineAllowanceCents,
  type Allowance,
  type AllowanceLineInput,
} from "@/lib/money";

export type DiscountKind = "percent" | "amount";

export interface CartLine {
  product: CounterProduct;
  qty: number;
  discountKind?: DiscountKind;
  discountPct?: number;
  discountAmountCents?: number;
}

/**
 * Where a settle attempt died.
 *
 * `issue_document` and `record_payment` both replay purely on (tenant_id, key) and ignore their
 * other arguments. Once a settle reaches `issue_document`, a lost response is indistinguishable
 * from a lost request, so an invoice may exist under this sale's key. Re-sending the IDENTICAL
 * request replays it; sending a DIFFERENT basket under the same key settles the customer against
 * the stale document. So the basket freezes until the attempt resolves.
 *
 * - `uncertain` — `issue_document` itself failed. The invoice may or may not exist.
 * - `issued` — the invoice exists; `record_payment` failed, and it too may have committed.
 */
export type SettlePhase = "uncertain" | "issued";

export interface PendingSettle {
  phase: SettlePhase;
  invoiceNo: string | null;
}

export const SETTLE_LOCK_NOTICE = "Finish or abandon this sale before changing the basket.";

/**
 * Rejections that are DEFINITIVE: the server refused before anything costing money
 * committed. These surface as plain errors — the basket stays live — instead of the
 * false "couldn't confirm the sale reached the server" freeze.
 * Mirrors DETERMINISTIC_ISSUE_REJECTIONS in the Android SaleRepository — keep in step.
 */
const DETERMINISTIC_ISSUE_REJECTIONS = [
  "the day is closed", // app.assert_day_open
  "closed — reopen it", // day gate, dated variant
  "still on the day of", // app.assert_till_day_current — till left open since yesterday
  "unknown or closed cash session",
  "must be taken on an open till",
  "no stock location",
  "cannot issue a document with no lines",
  "an invoice requires a customer",
  "insufficient privileges",
  "discount exceeds allowance", // app.assert_discount_allowed — over the document's ceiling
  "a reason is required",       // …or reaching a carwash allowance with nothing said about why
];

export function isDeterministicRejection(message: string): boolean {
  const m = message.toLowerCase();
  return DETERMINISTIC_ISSUE_REJECTIONS.some((s) => m.includes(s));
}

/**
 * Retrying is the safe act — re-sending the same request replays it, so it can never charge
 * twice. Abandoning is not: if the payment did commit, the invoice is `paid`, which keeps it
 * out of TO COLLECT and out of reach of `void_document`.
 */
export function settleMessage(p: PendingSettle): string {
  if (p.phase === "issued") {
    const inv = p.invoiceNo ? `Invoice ${p.invoiceNo}` : "The invoice";
    return `${inv} was issued but the payment didn't confirm. Charge again — retrying can never charge twice. Abandoning leaves it on the server.`;
  }
  return "Couldn't confirm the sale reached the server. Charge again to finish it — don't change the basket.";
}

/** Everything a settle sends to the server. It must not move between an attempt and its retry. */
export interface Basket {
  lines: CartLine[];
  orderDiscKind: DiscountKind | null;
  orderDiscValue: number; // percent → %, amount → cents
  /** Why the discount was given. Rides to the server on `documents.discount_reason`, where
   *  app.assert_discount_allowed reads it back — so it belongs to the basket, beside the
   *  discount it explains, and freezes with it. "" = nothing said yet. */
  orderDiscReason: string;
  /** What an owner approved for THIS sale, in VAT-inclusive cents — null = no approval.
   *  Recorded server-side against the sale's draft id, so it must never outlive the ticket
   *  it was given for; see [generation]. */
  approvedMaxCents: number | null;
  /** Bumped when a ticket ends by being emptied. The till mints a fresh saleKey and draft id
   *  from it, because an owner override is pinned to a DOCUMENT ID server-side — reusing the
   *  id would let a rebuilt basket inherit an approval the owner never saw. Frozen mid-settle
   *  along with everything else, so a replay can never be sent under a different key. */
  generation: number;
  customer: string;
  customerId: string | null;
  pending: PendingSettle | null;
  notice: string | null;
}

export const EMPTY_BASKET: Basket = {
  lines: [],
  orderDiscKind: null,
  orderDiscValue: 0,
  orderDiscReason: "",
  approvedMaxCents: null,
  generation: 0,
  customer: "",
  customerId: null,
  pending: null,
  notice: null,
};

const refuse = (b: Basket): Basket => ({ ...b, notice: SETTLE_LOCK_NOTICE });

/**
 * Every line change lands here. Emptying the cart ends the ticket, so the whole-sale discount
 * goes with it — otherwise a discount typed for one walk-in silently re-prices the next basket
 * built on this screen, and the "Discount" row is hidden on an empty cart so nothing warns you.
 *
 * The rule fires on the TRANSITION to empty, not on "the cart is empty": clearing it whenever
 * there are no lines would erase a discount typed before the first item is scanned.
 */
function withLines(b: Basket, lines: CartLine[]): Basket {
  return lines.length === 0 && b.lines.length > 0
    ? {
        ...b,
        lines,
        orderDiscKind: null,
        orderDiscValue: 0,
        orderDiscReason: "",
        // The approval dies with the ticket, and the sale's identity goes with it: clearing
        // only the client figure would leave the override row still pinned to a draft id the
        // next basket would reuse, and the server honours what it finds by that id.
        approvedMaxCents: null,
        generation: b.generation + 1,
      }
    : { ...b, lines };
}

export function addProduct(b: Basket, p: CounterProduct): Basket {
  if (b.pending) return refuse(b);
  const i = b.lines.findIndex((l) => l.product.id === p.id);
  return withLines(
    b,
    i >= 0
      ? b.lines.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      : [...b.lines, { product: p, qty: 1 }],
  );
}

export function setQty(b: Basket, productId: string, qty: number): Basket {
  if (b.pending) return refuse(b);
  return withLines(
    b,
    qty <= 0
      ? b.lines.filter((l) => l.product.id !== productId)
      : b.lines.map((l) => (l.product.id === productId ? { ...l, qty } : l)),
  );
}

export function patchLine(b: Basket, productId: string, patch: Partial<CartLine>): Basket {
  if (b.pending) return refuse(b);
  return withLines(b, b.lines.map((l) => (l.product.id === productId ? { ...l, ...patch } : l)));
}

/** The whole-sale discount rides on `documents.discount_value`, so it is part of the basket. */
export function setOrderDiscount(b: Basket, kind: DiscountKind | null, value: number): Basket {
  if (b.pending) return refuse(b);
  return { ...b, orderDiscKind: kind, orderDiscValue: value };
}

/** The reason is document content too — `documents.discount_reason` — so it freezes alongside. */
export function setOrderDiscountReason(b: Basket, reason: string): Basket {
  if (b.pending) return refuse(b);
  return { ...b, orderDiscReason: reason };
}

/** An owner's approval, already recorded server-side against this sale's draft id. */
export function setApprovedMax(b: Basket, cents: number | null): Basket {
  if (b.pending) return refuse(b);
  return { ...b, approvedMaxCents: cents };
}

/** Who the invoice bills is baked into the issued document, so it freezes with the basket. */
export function setCustomerName(b: Basket, name: string): Basket {
  if (b.pending) return refuse(b);
  return { ...b, customer: name, customerId: null };
}

export function pickCustomer(b: Basket, id: string, name: string): Basket {
  if (b.pending) return refuse(b);
  return { ...b, customer: name, customerId: id };
}

// ─── what the ticket may give away ──────────────────────────────────────────────────────
//
// The web mirror of app.document_discount_limits / app.assert_discount_allowed. The DATABASE
// is the authority and refuses inside issue_document; this exists so the counter can clamp an
// input and say the limit out loud, instead of the cashier meeting a raw Postgres error with
// a customer standing at the till.
//
// Every counter line comes from the catalogue and sends line_kind null, so the product's own
// policy is the whole answer — the same fallback the SQL computes from its product join.

/** A cart line as the allowance arithmetic wants it: the policy beside the price. */
function allowanceLine(l: CartLine): AllowanceLineInput {
  return {
    qty: l.qty,
    unitCents: l.product.priceCents,
    vatRatePct: l.product.vatRate,
    policy: l.product.discountPolicy,
    discountKind: l.discountKind,
    discountPct: l.discountPct,
    discountAmountCents: l.discountAmountCents,
  };
}

/**
 * What this ticket may discount, what it does discount, and whether that needs a reason.
 *
 * `carwashPct` is the owner's live cap (business_settings.discount_carwash_pct). It defaults
 * to the old constant so a caller that has not loaded the settings behaves as the shop did
 * before the cap was editable — but the till DOES load them, because clamping at 5 while the
 * database allows 10 would refuse a discount the shop expressly permits.
 */
export function basketAllowance(b: Basket, carwashPct: number = CARWASH_MAX_PCT): Allowance {
  return computeAllowance(
    b.lines.map(allowanceLine),
    b.orderDiscKind ? { kind: b.orderDiscKind, value: b.orderDiscValue } : null,
    // An owner's PIN, checked server-side, raises the ceiling for this sale only — and
    // carries its own reason, so it answers the reason box too.
    b.approvedMaxCents,
    carwashPct,
  );
}

export interface LineDiscountLimits {
  disabled: boolean;
  pctMax: number;
  amtMaxCents: number;
}

/** What one line's discount control may offer before it starts refusing keystrokes. */
export function lineDiscountLimits(l: CartLine, carwashPct: number = CARWASH_MAX_PCT): LineDiscountLimits {
  const policy = l.product.discountPolicy;
  return {
    disabled: policy === "none",
    pctMax: policy === "carwash" ? carwashPct : 100,
    // Only a carwash has a ceiling a typed Rs figure can cross; goods may go to zero.
    amtMaxCents: policy === "carwash" ? lineAllowanceCents(allowanceLine(l), carwashPct) : Infinity,
  };
}

/**
 * Why this ticket cannot be charged yet — null when it can.
 *
 * Past the ceiling there is no escape route from the till: the owner-approval override is a
 * separate task, still pending for the document builder too, so the wording sends the cashier
 * to the owner rather than offering a door that isn't built.
 */
export function discountBlockReason(b: Basket, carwashPct: number = CARWASH_MAX_PCT): string | null {
  const a = basketAllowance(b, carwashPct);
  if (a.overCeiling) {
    return `This discount is over the ${formatMUR(a.ceilingCents)} allowed on this sale — ask the owner.`;
  }
  if (a.reasonRequired && !b.orderDiscReason.trim()) {
    return "Add a reason for this discount before charging.";
  }
  return null;
}

/**
 * Only a failure that reached `issue_document` freezes the basket. Anything earlier — a bad
 * product snapshot, a rejected customer, a failed `save_draft` — has committed nothing that
 * costs money, so the cashier keeps editing.
 */
export function withSettleFailure(
  b: Basket,
  r: { settle?: SettlePhase; invoiceNo?: string | null },
): Basket {
  if (!r.settle) return b;
  const prev = b.pending;
  // Never downgrade what we already know: once a settle is at phase 'issued' with an invoice
  // number, a later retry that fails before the server answers (settle 'uncertain', no number)
  // must keep the phase and the number the cashier was shown — not blank it back to 'uncertain'.
  const phase: SettlePhase = prev?.phase === "issued" ? "issued" : r.settle;
  const invoiceNo = r.invoiceNo ?? prev?.invoiceNo ?? null;
  return { ...b, pending: { phase, invoiceNo } };
}

/** A settle that came back `ok` resolved the invoice, so the basket thaws. */
export function settleResolved(b: Basket): Basket {
  return b.pending ? { ...b, pending: null, notice: null } : b;
}
