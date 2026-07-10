import type { CounterProduct } from "@/lib/supabase/queries/counter";

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
  customer: string;
  customerId: string | null;
  pending: PendingSettle | null;
  notice: string | null;
}

export const EMPTY_BASKET: Basket = {
  lines: [],
  orderDiscKind: null,
  orderDiscValue: 0,
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
    ? { ...b, lines, orderDiscKind: null, orderDiscValue: 0 }
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

/** Who the invoice bills is baked into the issued document, so it freezes with the basket. */
export function setCustomerName(b: Basket, name: string): Basket {
  if (b.pending) return refuse(b);
  return { ...b, customer: name, customerId: null };
}

export function pickCustomer(b: Basket, id: string, name: string): Basket {
  if (b.pending) return refuse(b);
  return { ...b, customer: name, customerId: id };
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
  return { ...b, pending: { phase: r.settle, invoiceNo: r.invoiceNo ?? null } };
}

/** A settle that came back `ok` resolved the invoice, so the basket thaws. */
export function settleResolved(b: Basket): Basket {
  return b.pending ? { ...b, pending: null, notice: null } : b;
}
