// What "low stock" means — decided once, because two places were quietly
// deciding it differently.
//
// The bell counted products with stock SOMEWHERE but not enough on the selling
// floor: 11. The catalogue's LOW badge ignored the "somewhere" and flagged 36.
// Both are defensible; having both is not. Click an alert that says 11 and land
// on a list of 36 and you stop believing either number.
//
// So the difference is named instead of averaged, because it is a real one and
// the owner does something different about each:
//
//   low → short out front, but the studio holds some of it. Worth a look.
//   out → there is none, anywhere. No amount of moving fixes that; it has to be
//         bought. Louder than low, and a different job.
//
// What `low` does NOT promise is that the warehouse has any: on the live
// catalogue, 9 of the 11 low products had an empty warehouse and only 2 could
// actually be moved. The stock they hold is already sitting on the floor. So
// whether a transfer is even possible is a separate question — canMove — and the
// alert says which, rather than sending someone to fetch what isn't there.
//
// Anything without a threshold, or not stocked at all (a service), has no
// opinion to offer.

export type StockState = "ok" | "low" | "out";

export interface StockLevel {
  isStocked: boolean;
  /** null = the owner never set one, so there's nothing to be under. */
  threshold: number | null;
  /** On the selling floor — the only stock a customer at the counter can buy. */
  floorQty: number | null;
  /** Everywhere, floor included. Decides low vs out. */
  totalQty: number;
}

export function stockState(i: StockLevel): StockState {
  if (!i.isStocked || i.threshold == null || i.floorQty == null) return "ok";
  if (i.floorQty >= i.threshold) return "ok";
  return i.totalQty > 0 ? "low" : "out";
}

/** The one the bell counts and the catalogue's "Low at the floor" filter shows. */
export const isLow = (i: StockLevel) => stockState(i) === "low";

/** Is there stock somewhere OTHER than the floor — i.e. can a transfer fix this?
 *  The difference between "go and fetch it" and "order more", and the reason the
 *  alert stopped promising a warehouse trip that would come back empty. */
export const canMove = (i: StockLevel) => i.totalQty - (i.floorQty ?? 0) > 0;
