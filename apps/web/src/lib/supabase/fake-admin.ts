// Test double for the service-role client: in-memory tables behind the slice of
// the supabase-js query builder the inbound paths use. Unlike a canned-answer
// stub, .eq() really filters and .order() really sorts, so a query that forgets
// a filter gets the wrong row back — exactly how it would in Postgres. Any chain
// method it doesn't implement throws, so a new call can't silently pass.
// Test-only: imported from *.test.ts, never from app code.

type Row = Record<string, unknown>;

export function fakeAdmin(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const all = (tables[table] ??= []);
    const filters: [string, unknown][] = [];
    const orders: [string, 1 | -1][] = []; // first call is the primary key, as in PostgREST
    let limit = Infinity;
    let patch: Row | null = null;

    // Evaluated when the chain ends, so call order doesn't matter — same as SQL.
    const run = () =>
      all
        .filter((r) => filters.every(([col, val]) => r[col] === val))
        .sort((a, b) => {
          for (const [col, dir] of orders) {
            const x = String(a[col]), y = String(b[col]);
            if (x !== y) return x < y ? -dir : dir;
          }
          return 0;
        })
        .slice(0, limit);

    const builder: Record<string, unknown> = {
      select: () => proxy,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return proxy;
      },
      order: (col: string, opts: { ascending?: boolean } = {}) => {
        orders.push([col, opts.ascending === false ? -1 : 1]);
        return proxy;
      },
      limit: (n: number) => {
        limit = n;
        return proxy;
      },
      single: async () => {
        const rows = run();
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: `single() saw ${rows.length} rows` } };
      },
      maybeSingle: async () => {
        const rows = run();
        return rows.length > 1
          ? { data: null, error: { message: `maybeSingle() saw ${rows.length} rows` } }
          : { data: rows[0] ?? null, error: null };
      },
      insert: async (row: Row) => {
        all.push({ ...row });
        return { data: null, error: null };
      },
      update: (p: Row) => {
        patch = p;
        return proxy;
      },
      // Awaiting the chain runs it: an update writes to the rows the filters kept.
      then: (resolve: (v: unknown) => void) => {
        const rows = run();
        if (patch) for (const r of rows) Object.assign(r, patch);
        resolve({ data: rows, error: null });
      },
    };

    const proxy: unknown = new Proxy(builder, {
      get(target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop in target) return target[prop];
        throw new Error(`fakeAdmin: .${prop}() is not implemented for "${table}"`);
      },
    });
    return proxy;
  };

  return { from } as never;
}
