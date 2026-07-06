// PostgREST caps every read at the project's db `max_rows` (1000). For queries
// whose ROWS we aggregate in JS (report totals, counts), that cap silently
// undercounts once a tenant exceeds 1000 matching rows. Page through with
// `.range()` until a short page proves we've reached the end.
//
// `make` MUST return a FRESH, filtered query each call — Supabase builders are
// single-use. Order by a unique column (default `id`) so paging is stable.
const PAGE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows<T = any>(make: () => any, orderCol = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await make().order(orderCol, { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE || offset > 1_000_000) break; // short page = done; hard backstop
  }
  return out;
}
