import { describe, it, expect } from "vitest";
import { computeTotals } from "@/lib/money";
import type { CounterProduct } from "@/lib/supabase/queries/counter";
import {
  EMPTY_BASKET,
  SETTLE_LOCK_NOTICE,
  addProduct,
  patchLine,
  pickCustomer,
  setCustomerName,
  setOrderDiscount,
  setQty,
  settleMessage,
  settleResolved,
  withSettleFailure,
  type Basket,
} from "./settle";

const product = (id: string, priceCents: number): CounterProduct => ({
  id,
  name: `Part ${id}`,
  kind: "product",
  category: null,
  priceCents,
  vatRate: 15,
  barcode: null,
  isStocked: true,
  shopQty: 10,
  warehouseQty: 0,
});

const brakePad = product("p1", 100_000);
const wiper = product("p2", 20_000);

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
