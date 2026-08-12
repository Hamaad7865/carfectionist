import { describe, it, expect } from "vitest";
import { computeTotals, formatMUR, type DiscountPolicy } from "@/lib/money";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import {
  EMPTY_BASKET,
  SETTLE_LOCK_NOTICE,
  addProduct,
  basketAllowance,
  discountBlockReason,
  isDeterministicRejection,
  lineDiscountLimits,
  patchLine,
  pickCustomer,
  setApprovedMax,
  setCustomerName,
  setOrderDiscount,
  setOrderDiscountReason,
  setQty,
  settleMessage,
  settleResolved,
  withSettleFailure,
  type Basket,
} from "./settle";

const product = (id: string, priceCents: number, discountPolicy: DiscountPolicy = "free"): CounterProduct => ({
  id,
  name: `Part ${id}`,
  kind: discountPolicy === "free" ? "product" : "service",
  category: null,
  priceCents,
  vatRate: 15,
  discountPolicy,
  priceIncludesVat: false,
  barcode: null,
  photoUrl: null,
  isStocked: true,
  shopQty: 10,
  warehouseQty: 0,
});

const brakePad = product("p1", 100_000);
const wiper = product("p2", 20_000);
/** Rs 1,000.00 net @ 15% → Rs 1,150.00 on the shelf; a carwash may give away 5% of that = Rs 57.50. */
const carwash = product("s1", 100_000, "carwash");
/** A price_includes_vat carwash: priceCents IS the Rs 1,000.00 gross, so 5% = Rs 50.00 (not 57.50).
 *  The ceiling must extract VAT, matching SQL app.document_discount_limits (20260812000030). */
const flaggedCarwash: CounterProduct = { ...product("s2", 100_000, "carwash"), priceIncludesVat: true };
/** A service the owner discounts by nothing at all. */
const bodyPolish = product("s2", 100_000, "none");

/** Cart A: one Rs 1,000 line, 10% off the whole sale — the ticket the cashier tried to settle. */
const cartA = (): Basket =>
  setOrderDiscount(addProduct(EMPTY_BASKET, brakePad), "percent", 10);

const issueLost = { settle: "uncertain" } as const;
const paymentLost = { settle: "issued" as const, invoiceNo: "INV-0007" };

describe("a settle that reached issue_document freezes the basket", () => {
  it("refuses to add a product", () => {
    const frozen = withSettleFailure(cartA(), paymentLost);
    const edited = addProduct(frozen, wiper);

    expect(edited.lines).toEqual(frozen.lines);
    expect(edited.notice).toBe(SETTLE_LOCK_NOTICE);
  });

  it("refuses to change a quantity or drop a line", () => {
    const frozen = withSettleFailure(cartA(), paymentLost);

    expect(setQty(frozen, "p1", 5).lines).toEqual(frozen.lines);
    expect(setQty(frozen, "p1", 0).lines).toEqual(frozen.lines);
    expect(setQty(frozen, "p1", 0).notice).toBe(SETTLE_LOCK_NOTICE);
  });

  it("refuses to change a line discount", () => {
    const frozen = withSettleFailure(cartA(), paymentLost);
    const edited = patchLine(frozen, "p1", { discountKind: "percent", discountPct: 50 });

    expect(edited.lines).toEqual(frozen.lines);
    expect(edited.notice).toBe(SETTLE_LOCK_NOTICE);
  });

  /**
   * The order discount lives on `documents.discount_value`, not on document_lines. A basket
   * that freezes its lines but not this one still lets the cashier halve the price of an
   * already-issued invoice.
   */
  it("refuses to change the whole-sale discount", () => {
    const frozen = withSettleFailure(cartA(), paymentLost);
    const edited = setOrderDiscount(frozen, "percent", 50);

    expect(edited.orderDiscKind).toBe("percent");
    expect(edited.orderDiscValue).toBe(10);
    expect(edited.notice).toBe(SETTLE_LOCK_NOTICE);
  });

  it("refuses to change who the invoice bills", () => {
    const frozen = withSettleFailure(cartA(), paymentLost);

    expect(setCustomerName(frozen, "Someone else").customer).toBe("");
    expect(pickCustomer(frozen, "c9", "Someone else").customerId).toBeNull();
    expect(pickCustomer(frozen, "c9", "Someone else").notice).toBe(SETTLE_LOCK_NOTICE);
  });

  it("freezes when issue_document itself failed, with no invoice to name", () => {
    const frozen = withSettleFailure(cartA(), issueLost);

    expect(frozen.pending).toEqual({ phase: "uncertain", invoiceNo: null });
    expect(addProduct(frozen, wiper).lines).toEqual(frozen.lines);
  });

  /** Retrying re-sends the identical request, which is exactly what the server replay needs. */
  it("leaves the basket byte-identical for an identical retry", () => {
    const before = cartA();
    const frozen = withSettleFailure(before, paymentLost);

    expect(frozen.lines).toEqual(before.lines);
    expect(frozen.orderDiscKind).toBe(before.orderDiscKind);
    expect(frozen.orderDiscValue).toBe(before.orderDiscValue);
    expect(frozen.customerId).toBe(before.customerId);
  });

  /** A retry that fails before the server answers must not blank the invoice we already know. */
  it("keeps the issued invoice number when a retry fails without one", () => {
    const issued = withSettleFailure(cartA(), paymentLost); // phase 'issued', INV-0007
    const afterRetry = withSettleFailure(issued, issueLost); // retry dies early: 'uncertain', no number

    expect(afterRetry.pending).toEqual({ phase: "issued", invoiceNo: "INV-0007" });
  });

  it("upgrades uncertain → issued once a number is known", () => {
    const uncertain = withSettleFailure(cartA(), issueLost);
    const upgraded = withSettleFailure(uncertain, paymentLost);

    expect(upgraded.pending).toEqual({ phase: "issued", invoiceNo: "INV-0007" });
  });

  /** The reported bug: cart B must never be built on top of cart A's issued invoice. */
  it("makes the reported mischarge unreachable", () => {
    const cartB = setOrderDiscount(
      setQty(addProduct(withSettleFailure(cartA(), paymentLost), wiper), "p1", 0),
      null,
      0,
    );

    expect(cartB.lines).toHaveLength(1);
    expect(cartB.lines[0].product.id).toBe("p1");
    expect(cartB.orderDiscKind).toBe("percent");
    expect(cartB.orderDiscValue).toBe(10);
  });
});

describe("a settle that never reached issue_document leaves the basket editable", () => {
  it("keeps editing after a save_draft or validation failure", () => {
    // No `settle` discriminant: no number drawn, no stock moved, nothing to replay.
    const failed = withSettleFailure(cartA(), { });

    expect(failed.pending).toBeNull();
    expect(addProduct(failed, wiper).lines).toHaveLength(2);
    expect(setOrderDiscount(failed, "amount", 50_000).orderDiscValue).toBe(50_000);
    expect(addProduct(failed, wiper).notice).toBeNull();
  });

  it("starts a fresh ticket unfrozen", () => {
    expect(EMPTY_BASKET.pending).toBeNull();
    expect(addProduct(EMPTY_BASKET, wiper).lines).toHaveLength(1);
  });

  /** A retry that finally succeeds thaws the basket, so the next ticket is not born frozen. */
  it("thaws once the settle resolves", () => {
    const thawed = settleResolved(withSettleFailure(cartA(), paymentLost));

    expect(thawed.pending).toBeNull();
    expect(thawed.notice).toBeNull();
    expect(addProduct(thawed, wiper).lines).toHaveLength(2);
  });
});

/** What the ticket footer will charge — the same call CounterSale makes. */
const price = (b: Basket) =>
  computeTotals(
    b.lines.map((l) => ({
      qty: l.qty,
      unitCents: l.product.priceCents,
      discountPct: l.discountPct,
      discountKind: l.discountKind,
      discountAmountCents: l.discountAmountCents,
      vatRatePct: l.product.vatRate,
    })),
    b.orderDiscKind ? { kind: b.orderDiscKind, value: b.orderDiscValue } : null,
  );

describe("the whole-sale discount dies with the ticket", () => {
  it("clears when the last line is removed", () => {
    const emptied = setQty(cartA(), "p1", 0);

    expect(emptied.lines).toHaveLength(0);
    expect(emptied.orderDiscKind).toBeNull();
    expect(emptied.orderDiscValue).toBe(0);
  });

  it("clears when the last line is stepped down to zero", () => {
    const emptied = setQty(cartA(), "p1", -1); // the − button at qty 1

    expect(emptied.orderDiscKind).toBeNull();
  });

  it("clears an Rs discount too", () => {
    const emptied = setQty(setOrderDiscount(addProduct(EMPTY_BASKET, brakePad), "amount", 50_000), "p1", 0);

    expect(emptied.orderDiscKind).toBeNull();
    expect(emptied.orderDiscValue).toBe(0);
  });

  /** The bug: the next walk-in must pay full price. Rs 1,000 excl + 15% VAT. */
  it("charges the next ticket in full", () => {
    const next = addProduct(setQty(cartA(), "p1", 0), brakePad);

    expect(price(next).totalCents).toBe(115_000);
    expect(price(cartA()).totalCents).toBeLessThan(115_000); // cartA really was discounted
  });
});

/**
 * `app.assert_discount_allowed` reads `documents.discount_reason` back, so the reason is
 * document content the settle SENDS — which puts it in the basket, beside the discount it
 * explains, rather than in a useState of its own.
 */
describe("the reason travels with the discount it explains", () => {
  it("starts a ticket with nothing said", () => {
    expect(EMPTY_BASKET.orderDiscReason).toBe("");
  });

  it("records why the discount was given", () => {
    const b = setOrderDiscountReason(cartA(), "regular customer");

    expect(b.orderDiscReason).toBe("regular customer");
  });

  /**
   * The reason reaches the server on `documents.discount_reason`. A basket that freezes its
   * discount but not the reason lets the cashier re-justify an invoice that already issued.
   */
  it("refuses to change once the settle reached issue_document", () => {
    const frozen = setOrderDiscountReason(withSettleFailure(cartA(), paymentLost), "something else");

    expect(frozen.orderDiscReason).toBe("");
    expect(frozen.notice).toBe(SETTLE_LOCK_NOTICE);
  });

  it("dies with the ticket, like the discount it explains", () => {
    const emptied = setQty(setOrderDiscountReason(cartA(), "regular customer"), "p1", 0);

    expect(emptied.orderDiscKind).toBeNull();
    expect(emptied.orderDiscReason).toBe("");
  });

  /** The transition guard again: an empty cart staying empty is not the end of a ticket. */
  it("is not wiped by a line change on an already-empty cart", () => {
    const typed = setOrderDiscountReason(setOrderDiscount(EMPTY_BASKET, "percent", 10), "repeat wash");
    const b = setQty(typed, "p1", 0);

    expect(b.orderDiscReason).toBe("repeat wash");
  });

  it("survives removing one line of two", () => {
    const b = setQty(addProduct(setOrderDiscountReason(cartA(), "regular customer"), wiper), "p2", 0);

    expect(b.orderDiscReason).toBe("regular customer");
  });
});

describe("the discount survives everything that is not the end of a ticket", () => {
  /** Typing the discount before scanning is a normal flow — only the transition to empty clears. */
  it("a discount typed before the first scan still applies to it", () => {
    const b = addProduct(setOrderDiscount(EMPTY_BASKET, "percent", 10), brakePad);

    expect(b.orderDiscKind).toBe("percent");
    expect(b.orderDiscValue).toBe(10);
    expect(price(b).totalCents).toBeLessThan(115_000);
  });

  /**
   * Pins the TRANSITION guard specifically. A line change that leaves an already-empty cart
   * empty is not the end of a ticket, so it must not wipe a discount the cashier just typed.
   * Without this, `lines.length === 0` alone would pass every other test in this file.
   */
  it("a line change on an already-empty cart does not clear a typed discount", () => {
    const typed = setOrderDiscount(EMPTY_BASKET, "percent", 10);
    const b = setQty(typed, "p1", 0); // no such line; the cart was empty and stays empty

    expect(b.lines).toHaveLength(0);
    expect(b.orderDiscKind).toBe("percent");
    expect(b.orderDiscValue).toBe(10);
  });

  it("survives removing one line of two", () => {
    const b = setQty(addProduct(cartA(), wiper), "p2", 0);

    expect(b.lines).toHaveLength(1);
    expect(b.orderDiscKind).toBe("percent");
    expect(b.orderDiscValue).toBe(10);
  });

  it("survives editing a line down to a lower quantity", () => {
    const b = setQty(cartA(), "p1", 1);

    expect(b.orderDiscKind).toBe("percent");
  });

  /** A frozen basket refuses the removal, so it must not clear the discount either. */
  it("is untouched when a removal is refused by the settle freeze", () => {
    const frozen = withSettleFailure(cartA(), paymentLost);
    const refused = setQty(frozen, "p1", 0);

    expect(refused.lines).toHaveLength(1);
    expect(refused.orderDiscKind).toBe("percent");
    expect(refused.orderDiscValue).toBe(10);
  });
});

describe("the cashier is steered to retry, not to abandon", () => {
  it("names the invoice and promises the retry cannot double-charge", () => {
    const msg = settleMessage({ phase: "issued", invoiceNo: "INV-0007" });

    expect(msg).toContain("INV-0007");
    expect(msg).toContain("never charge twice");
  });

  it("copes with an issued invoice whose number never came back", () => {
    expect(settleMessage({ phase: "issued", invoiceNo: null })).toContain("The invoice");
  });

  it("tells the cashier not to change the basket when the issue is unconfirmed", () => {
    expect(settleMessage({ phase: "uncertain", invoiceNo: null })).toContain("don't change the basket");
  });
});

/**
 * The web mirror of app.document_discount_limits, applied to a till basket. The DATABASE is
 * the authority and refuses at issue_document; this is what lets the counter clamp the input
 * and say the limit out loud, instead of the cashier meeting a raw Postgres error with a
 * customer standing there.
 */
describe("what a line's discount control may offer", () => {
  it("lets unrestricted goods go to anything", () => {
    const l = lineDiscountLimits({ product: brakePad, qty: 1 });

    expect(l.disabled).toBe(false);
    expect(l.pctMax).toBe(100);
    expect(l.amtMaxCents).toBe(Infinity);
  });

  it("shuts the control on a service that is discounted by nothing", () => {
    expect(lineDiscountLimits({ product: bodyPolish, qty: 1 }).disabled).toBe(true);
  });

  it("caps a carwash at 5% of its shelf price", () => {
    const l = lineDiscountLimits({ product: carwash, qty: 1 });

    expect(l.disabled).toBe(false);
    expect(l.pctMax).toBe(5);
    expect(l.amtMaxCents).toBe(5_750); // 5% of Rs 1,150.00 incl
  });

  it("caps the Rs ceiling per quantity, not per unit", () => {
    expect(lineDiscountLimits({ product: carwash, qty: 2 }).amtMaxCents).toBe(11_500);
  });

  it("caps a price_includes_vat carwash on the typed gross, not a re-grossed net", () => {
    // priceCents 100_000 IS the Rs 1,000.00 gross → 5% = Rs 50.00 (5_000c). Dropping the flag
    // re-grosses it to Rs 1,150.00 and would wrongly permit Rs 57.50, which the DB then refuses.
    expect(lineDiscountLimits({ product: flaggedCarwash, qty: 1 }).amtMaxCents).toBe(5_000);
  });

  /**
   * The cap is the owner's to set (business_settings.discount_carwash_pct, 20260812000010).
   * Reading the old 5 constant while the DB reads 10 would refuse a discount the shop now
   * expressly allows — the same failure ed3c0ba was written to end.
   */
  it("follows the owner's cap, not the old constant", () => {
    const l = lineDiscountLimits({ product: carwash, qty: 1 }, 10);

    expect(l.pctMax).toBe(10);
    expect(l.amtMaxCents).toBe(11_500); // 10% of Rs 1,150.00 incl
  });

  it("still falls back to 5% when the owner has set nothing", () => {
    expect(lineDiscountLimits({ product: carwash, qty: 1 }).pctMax).toBe(5);
  });
});

describe("the ticket says what it may give away, and refuses what it may not", () => {
  const ticket = (p: CounterProduct, kind: "percent" | "amount" | null = null, value = 0) =>
    kind ? setOrderDiscount(addProduct(EMPTY_BASKET, p), kind, value) : addProduct(EMPTY_BASKET, p);

  it("asks nothing of an undiscounted sale", () => {
    const b = ticket(carwash);

    expect(basketAllowance(b).actualCents).toBe(0);
    expect(basketAllowance(b).reasonRequired).toBe(false);
    expect(discountBlockReason(b)).toBeNull();
  });

  /** Goods cover their own discount, so the reason box must not nag on a normal parts sale. */
  it("asks no reason when goods cover the whole discount", () => {
    const b = ticket(brakePad, "amount", 5_000);

    expect(basketAllowance(b).reasonRequired).toBe(false);
    expect(discountBlockReason(b)).toBeNull();
  });

  it("wants a reason once the discount reaches a carwash allowance", () => {
    const b = ticket(carwash, "amount", 5_000);

    expect(basketAllowance(b).overCeiling).toBe(false);
    expect(basketAllowance(b).reasonRequired).toBe(true);
    expect(discountBlockReason(b)).toContain("reason");
  });

  it("is satisfied once the reason is typed", () => {
    const b = setOrderDiscountReason(ticket(carwash, "amount", 5_000), "regular customer");

    expect(discountBlockReason(b)).toBeNull();
  });

  it("is not satisfied by whitespace", () => {
    const b = setOrderDiscountReason(ticket(carwash, "amount", 5_000), "   ");

    expect(discountBlockReason(b)).toContain("reason");
  });

  /** A raised cap must reach the whole-sale check too, not just the line controls. */
  it("lets the ticket give away what a raised cap allows", () => {
    const b = ticket(carwash, "amount", 10_000); // over 5%, within 10%

    expect(discountBlockReason(b)).toContain("ask the owner");
    // At the owner's raised cap it is within allowance — so the block softens from "ask the
    // owner" to merely owing a reason, which the cashier can answer themselves.
    expect(basketAllowance(b, 10).overCeiling).toBe(false);
    expect(discountBlockReason(b, 10)).toContain("reason");
    expect(discountBlockReason(setOrderDiscountReason(b, "regular customer"), 10)).toBeNull();
  });

  it("sends the cashier to the owner past the ceiling, naming it", () => {
    const b = ticket(carwash, "amount", 10_000); // Rs 100 off a Rs 57.50 allowance

    expect(basketAllowance(b).overCeiling).toBe(true);
    expect(discountBlockReason(b)).toContain("ask the owner");
    expect(discountBlockReason(b)).toContain(formatMUR(5_750));
  });

  /** A reason cannot buy what only the owner can give. */
  it("stays blocked past the ceiling even with a reason", () => {
    const b = setOrderDiscountReason(ticket(carwash, "amount", 10_000), "regular customer");

    expect(discountBlockReason(b)).toContain("ask the owner");
  });

  it("refuses any discount at all on a service that allows none", () => {
    const b = ticket(bodyPolish, "percent", 1);

    expect(basketAllowance(b).ceilingCents).toBe(0);
    expect(discountBlockReason(b)).toContain("ask the owner");
  });

  /** The whole-sale field is the back door the DB closes: it spreads across services too. */
  it("counts a whole-sale discount against the ceiling, not just line discounts", () => {
    const b = setOrderDiscount(addProduct(addProduct(EMPTY_BASKET, carwash), bodyPolish), "percent", 50);

    expect(discountBlockReason(b)).toContain("ask the owner");
  });
});

/**
 * The owner's approval is recorded server-side against a DOCUMENT ID, and
 * app.assert_discount_allowed re-reads it by that id. The till has no document until it
 * charges, so it names its draft id ahead of time — which makes the id's lifecycle a money
 * question: a fresh basket must never inherit the previous one's approval.
 */
describe("an owner's approval belongs to the sale it was given for", () => {
  const overCeiling = () => setOrderDiscount(addProduct(EMPTY_BASKET, carwash), "amount", 10_000);

  it("starts a ticket with no approval", () => {
    expect(EMPTY_BASKET.approvedMaxCents).toBeNull();
    expect(EMPTY_BASKET.generation).toBe(0);
  });

  it("lifts the ceiling once the owner has approved that much", () => {
    expect(discountBlockReason(overCeiling())).toContain("ask the owner");

    const approved = setApprovedMax(overCeiling(), 10_000);

    expect(basketAllowance(approved).overCeiling).toBe(false);
    expect(discountBlockReason(approved)).toBeNull();
  });

  /** An approval carries its own reason, so it answers that too — as the DB's guard does. */
  it("answers the reason box as well", () => {
    const b = setApprovedMax(setOrderDiscount(addProduct(EMPTY_BASKET, carwash), "amount", 5_000), 5_000);

    expect(basketAllowance(b).reasonRequired).toBe(false);
    expect(discountBlockReason(b)).toBeNull();
  });

  it("still refuses a discount beyond what was approved", () => {
    const approved = setApprovedMax(setOrderDiscount(addProduct(EMPTY_BASKET, carwash), "amount", 20_000), 10_000);

    expect(discountBlockReason(approved)).toContain("ask the owner");
  });

  /**
   * The hole this closes: emptying the basket and ringing up something else must not inherit
   * the approval. Clearing the client figure is not enough on its own — the override row is
   * pinned to a document id server-side — so the generation bumps too, and the till mints a
   * new sale id from it.
   */
  it("dies with the ticket, and takes the sale's identity with it", () => {
    const emptied = setQty(setApprovedMax(overCeiling(), 10_000), "s1", 0);

    expect(emptied.approvedMaxCents).toBeNull();
    expect(emptied.generation).toBe(1);
  });

  it("does not bump the sale's identity while a ticket is merely being edited", () => {
    const b = setQty(addProduct(setApprovedMax(overCeiling(), 10_000), wiper), "p2", 0);

    expect(b.generation).toBe(0);
    expect(b.approvedMaxCents).toBe(10_000);
  });

  /**
   * Replay safety: `issue_document` and `record_payment` replay purely on the key, so the sale
   * id must be frozen once a settle is in flight. The freeze already refuses the edit that
   * would empty the cart — this pins that the generation cannot move behind it.
   */
  it("never changes the sale's identity mid-settle", () => {
    const frozen = withSettleFailure(overCeiling(), paymentLost);

    expect(setQty(frozen, "s1", 0).generation).toBe(0);
    expect(setApprovedMax(frozen, 99_999).approvedMaxCents).toBeNull();
    expect(setApprovedMax(frozen, 99_999).notice).toBe(SETTLE_LOCK_NOTICE);
  });
});

describe("definitive server refusals never freeze the basket", () => {
  it.each([
    "the day is closed — no more entries or transactions are possible",
    "the day of 2026-07-29 is closed — reopen it before taking any more money",
    "this till is still on the day of 2026-07-29 — close that service on the till, then open a new one, before taking today's money",
    "unknown or closed cash session",
    "an invoice requires a customer",
    // app.assert_discount_allowed, raised from inside issue_document. Nothing committed —
    // but until these were listed, a refused discount froze the basket behind "couldn't
    // confirm the sale reached the server" and the cashier retried a request the server
    // would refuse forever. The client clamp does not make these unreachable: a policy
    // changed since the page loaded still lands here.
    "discount exceeds allowance: Rs 1,200.00 requested, Rs 350.00 allowed",
    "a reason is required for a carwash discount",
  ])("recognises %s", (msg) => {
    expect(isDeterministicRejection(msg)).toBe(true);
  });

  it("treats a genuine network loss as NOT deterministic (the freeze stays)", () => {
    expect(isDeterministicRejection("fetch failed")).toBe(false);
    expect(isDeterministicRejection("TypeError: NetworkError when attempting to fetch resource")).toBe(false);
  });
});
