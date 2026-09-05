/**
 * One customer, several cars — and one rule for what order their charges print in.
 *
 * A bill that covers three cars heads each car's charges with its plate. Every surface
 * draws that heading the same cheap way: when this line's car differs from the one before
 * it. That test is only true if a car's charges are ADJACENT — and they are not, because
 * lines are stored in the order they were typed. A cashier who prices the Hilux, switches
 * to the Swift, then switches BACK to the Hilux (exactly what the car switcher invites)
 * stores them interleaved, and the Hilux is then headed twice, each heading claiming that
 * car's FULL subtotal. Rs 14,500 of car subtotals on an Rs 8,500 invoice.
 *
 * So the lines are put in car order BEFORE anything renders them, and adjacency becomes
 * true by construction. Cars appear in the order their first charge does — the order the
 * cashier worked in — and charges belonging to no car (a bottle off the shelf) come last.
 *
 * Fixing it here rather than at save time is deliberate: `app.document_cars()` derives the
 * car ORDER from `min(sort_order)`, and `convert_quote_to_jobs` builds the job cards from
 * that. Rewriting sort_order to fix a printing fault would quietly reorder job creation,
 * and would not touch the documents already in the database. Grouping at the point of
 * display fixes those too.
 */
export function orderByCar<T>(lines: readonly T[], keyOf: (line: T) => string): T[] {
  // A Map keeps insertion order, so the buckets come out in first-appearance order.
  const buckets = new Map<string, T[]>();
  for (const line of lines) {
    const key = keyOf(line);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(line);
    else buckets.set(key, [line]);
  }
  const loose = buckets.get("") ?? [];
  buckets.delete("");
  return [...Array.from(buckets.values()).flat(), ...loose];
}
