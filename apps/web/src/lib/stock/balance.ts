// How much is on the shelf — now, and right after each movement.
//
// On-hand IS the ledger summed (the stock_on_hand view), so the count after any
// one movement is today's on-hand minus everything that moved since. The
// Inventory tab shows the latest movements newest-first, so every movement later
// than a given row sits above it in the list: walk down, subtract as you go.
// That only holds for a deterministic order — two rows of a bulk stock count can
// share a moved_at, so the query breaks ties on id.

/** product id → location id → quantity on hand. */
export type OnHand = Record<string, Record<string, number>>;

/** Quantities are numeric(12,3): keep JS float noise (2.9999999) off the screen. */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

/** Zero when the ledger has never touched this product at this location. */
export function onHandAt(onHand: OnHand, productId: string, locationId: string): number {
  return onHand[productId]?.[locationId] ?? 0;
}

/** Stamp each movement (newest first) with the on-hand it left behind at its location. */
export function balancesAfter<T extends { productId: string; locationId: string; qty: number }>(
  newestFirst: T[],
  onHand: OnHand,
): (T & { balanceAfter: number })[] {
  const running = new Map<string, number>();
  return newestFirst.map((m) => {
    const key = `${m.productId}|${m.locationId}`;
    const after = running.get(key) ?? onHandAt(onHand, m.productId, m.locationId);
    running.set(key, roundQty(after - m.qty));
    return { ...m, balanceAfter: roundQty(after) };
  });
}
