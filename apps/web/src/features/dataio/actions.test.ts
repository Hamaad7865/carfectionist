import { beforeEach, describe, expect, it, vi } from "vitest";

// ── fakes ────────────────────────────────────────────────────────────────────
type Call = { rows: Record<string, string>[]; dryRun: boolean; basis: boolean | null | undefined };
const calls: Call[] = [];
let rpcImpl: (c: Call) => Promise<unknown>;
let products: { id: string; sku: string | null; name: string; price_includes_vat: boolean }[] = [];
const updates: { patch: Record<string, unknown>; ids: string[]; onlyFlagged: boolean }[] = [];
let updateError: string | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/rpc", () => ({
  importCustomers: vi.fn(),
  importProducts: vi.fn(async (_sb: unknown, rows: Record<string, string>[], dryRun: boolean, basis?: boolean | null) => {
    const c = { rows, dryRun, basis };
    calls.push(c);
    return rpcImpl(c);
  }),
}));
vi.mock("@/lib/supabase/paginate", () => ({ fetchAllRows: vi.fn(async () => products) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        in: (_c: string, ids: string[]) => ({
          eq: async () => {
            updates.push({ patch, ids, onlyFlagged: true });
            return { error: updateError ? { message: updateError } : null };
          },
        }),
      }),
      select: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: products, error: null }) }) }) }),
    }),
  }),
}));

import { importProductsAction } from "./actions";

const ok = (n: number, errors: { sku?: string; name?: string; error: string }[] = []) => ({
  inserted: 0, updated: n, skipped: errors.length, stock_adjusted: 0, errors,
});

beforeEach(() => {
  calls.length = 0;
  updates.length = 0;
  updateError = null;
  products = [];
  rpcImpl = async (c) => ok(c.rows.length);
});

describe("importProductsAction — price_includes_vat", () => {
  it("a sheet WITHOUT the column is the single, unchanged call (shop default)", async () => {
    const rows = [{ sku: "A", name: "A", selling_price: "115" }, { sku: "B", name: "B", selling_price: "230" }];
    const r = await importProductsAction(rows, false);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].basis).toBeNull();
    expect(calls[0].rows).toBe(rows);
  });

  it("splits yes / no / blank into three calls with the matching override", async () => {
    const rows = [
      { sku: "A", name: "A", selling_price: "115", price_includes_vat: "yes" },
      { sku: "B", name: "B", selling_price: "100", price_includes_vat: "no" },
      { sku: "C", name: "C", selling_price: "50", price_includes_vat: "" },
    ];
    const r = await importProductsAction(rows, true);
    expect(r.ok && r.report.updated).toBe(3);
    expect(calls.map((c) => [c.basis, c.rows.map((x) => x.sku)])).toEqual([
      [null, ["C"]],
      [true, ["A"]],
      [false, ["B"]],
    ]);
    expect(calls.every((c) => c.dryRun)).toBe(true);
    expect(updates).toEqual([]); // a dry run never writes
  });

  it("a row with an unknown answer is skipped, counted, reported — and never sent", async () => {
    const rows = [
      { sku: "A", name: "A", selling_price: "115", price_includes_vat: "maybe" },
      { sku: "B", name: "B", selling_price: "100", price_includes_vat: "no" },
    ];
    const r = await importProductsAction(rows, true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.skipped).toBe(1);
    expect(r.report.updated).toBe(1);
    expect(r.report.errors).toHaveLength(1);
    expect(calls.flatMap((c) => c.rows.map((x) => x.sku))).toEqual(["B"]);
  });

  it("clears the flag only on flagged products that were repriced (and writes nothing else)", async () => {
    products = [
      { id: "p1", sku: "A", name: "A", price_includes_vat: true },  // repriced + flagged → cleared
      { id: "p2", sku: "B", name: "B", price_includes_vat: true },  // flagged but its row errored → untouched
      { id: "p3", sku: "C", name: "C", price_includes_vat: true },  // flagged, not in sheet → untouched
      { id: "p4", sku: "D", name: "D", price_includes_vat: false }, // repriced, not flagged → nothing to clear
    ];
    rpcImpl = async (c) => ok(c.rows.length - 1, [{ sku: "B", name: "B", error: "invalid input syntax for type numeric" }]);
    const rows = [
      { sku: "A", name: "A", selling_price: "9900" },
      { sku: "B", name: "B", selling_price: "oops" },
      { sku: "D", name: "D", selling_price: "100" },
    ];
    const r = await importProductsAction(rows, false);
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].ids).toEqual(["p1"]);
    expect(updates[0].patch).toEqual({ price_includes_vat: false });
  });

  it("a row with no price leaves its flag alone", async () => {
    products = [{ id: "p1", sku: "A", name: "A", price_includes_vat: true }];
    await importProductsAction([{ sku: "A", name: "A", selling_price: "", cost_price: "5" }], false);
    expect(updates).toEqual([]);
  });

  it("if the flag reset fails the import still reports success for prices but says so loudly", async () => {
    products = [{ id: "p1", sku: "A", name: "A", price_includes_vat: true }];
    updateError = "boom";
    const r = await importProductsAction([{ sku: "A", name: "A", selling_price: "10" }], false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.updated).toBe(1);
    expect(r.report.errors.some((e) => e.error.includes("could not be reset"))).toBe(true);
  });

  it("a later call failing says how much was already saved, and still clears flags for the saved part", async () => {
    products = [{ id: "p1", sku: "A", name: "A", price_includes_vat: true }];
    let n = 0;
    rpcImpl = async (c) => {
      if (++n === 2) throw new Error("connection lost");
      return ok(c.rows.length);
    };
    const rows = [
      { sku: "A", name: "A", selling_price: "10", price_includes_vat: "" },
      { sku: "B", name: "B", selling_price: "20", price_includes_vat: "yes" },
    ];
    const r = await importProductsAction(rows, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("part-way");
    expect(r.error).toContain("1 product(s) were already saved");
    expect(updates.map((u) => u.ids)).toEqual([["p1"]]);
  });

  it("a failure on the very first call is just that error", async () => {
    rpcImpl = async () => { throw new Error("permission denied"); };
    const r = await importProductsAction([{ sku: "A", name: "A", selling_price: "1" }], false);
    expect(r).toEqual({ ok: false, error: "permission denied" });
  });
});
