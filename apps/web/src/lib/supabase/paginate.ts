// PostgREST caps every read at the project's db `max_rows` (1000). For queries
// whose ROWS we aggregate in JS (report totals, counts), that cap silently
// undercounts once a tenant exceeds 1000 matching rows. Page through with
// `.range()` until a short page proves we've reached the end.
//
// `make` MUST return a FRESH, filtered query each call — Supabase builders are
// single-use. Order by a unique column (default `id`) so paging is stable.
const PAGE = 1000;

interface PageableQuery<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export function fixedIsoUpperBound(
  endExclusiveIso: string,
  nowMs = Date.now(),
): string {
  return new Date(
    Math.min(Date.parse(endExclusiveIso), nowMs),
  ).toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows<T = any>(make: () => any, orderCol: string | string[] = "id"): Promise<T[]> {
  // Order by a UNIQUE key so paging is stable — a non-unique column (e.g.
  // stock_on_hand.product_id, one row per location) risks skipped/duplicated
  // rows across page boundaries. Pass a compound key for such views.
  const cols = Array.isArray(orderCol) ? orderCol : [orderCol];
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = make();
    for (const c of cols) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE || offset > 1_000_000) break; // short page = done; hard backstop
  }
  return out;
}

// Keyset pagination for reads whose ordering key is immutable. `make` must
// return a fresh query ordered by the same cursor represented by `cursorOf`,
// and must restrict rows to values strictly after `after` when it is non-null.
// Unlike OFFSET paging, inserts before the cursor cannot shift later pages.
export async function fetchAllRowsByKeyset<T, Cursor>(
  make: (after: Cursor | null) => PageableQuery<T>,
  cursorOf: (row: T) => Cursor,
  compareCursor: (left: Cursor, right: Cursor) => number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: Cursor | null = null;

  for (;;) {
    const { data, error } = await make(cursor).range(0, PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];

    for (const row of rows) {
      const nextCursor = cursorOf(row);
      if (cursor !== null && compareCursor(nextCursor, cursor) <= 0) {
        throw new Error("Keyset pagination cursor did not advance");
      }
      cursor = nextCursor;
      out.push(row);
    }

    if (rows.length < PAGE) break;
  }

  return out;
}
