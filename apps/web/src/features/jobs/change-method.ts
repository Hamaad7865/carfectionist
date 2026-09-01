export type ChangeableMethod = "cash" | "card" | "juice" | "bank_transfer" | "cheque";

const ALL: ChangeableMethod[] = ["cash", "card", "juice", "bank_transfer", "cheque"];

/**
 * The methods a recorded payment currently in `current` may be switched to.
 * Empty ⇒ don't show the control. Mirrors `change_payment_method`'s server
 * guards: never `points`/`credit` on either side; a `cash` SOURCE row is
 * owner/manager only (changing away from cash removes a drawer expectation).
 */
export function methodChangeTargets(
  current: string,
  opts: { canManage: boolean },
): ChangeableMethod[] {
  if (current === "points" || current === "credit") return [];
  if (current === "cash" && !opts.canManage) return [];
  return ALL.filter((m) => m !== current);
}
