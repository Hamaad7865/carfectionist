/**
 * The optional `price_includes_vat` column of a product spreadsheet.
 *
 * Without the column a sheet is read the way the shop declares (business_settings.prices_vat_exclusive):
 * a gross-quoting shop's prices are shelf prices and import_products divides them to net (migration
 * 0040). With the column each row says for itself what ITS selling_price means:
 *
 *   yes → the price includes VAT  → import_products divides it to net (as for a gross-quoting shop)
 *   no  → the price is net        → stored exactly as typed
 *   blank → the shop's own default
 *
 * import_products takes ONE answer per call (p_prices_incl_vat), so the action sends the rows in up to
 * three calls, one per answer. No SQL changes: the guard that already stores the right net does the
 * arithmetic. A row whose answer is not understood is refused, never guessed — a wrong guess is a
 * price off by the VAT.
 */

export type PriceBasis = boolean | null; // true = includes VAT, false = net, null = the shop's default

export interface VatRowError { sku?: string; name?: string; error: string }
export interface VatGroup { basis: PriceBasis; rows: Record<string, string>[] }
export interface VatPlan {
  groups: VatGroup[];
  /** Rows refused before they reach the database (counted as skipped by the caller). */
  errors: VatRowError[];
}

const YES = new Set(["yes", "y", "true", "1", "incl", "inclusive"]);
const NO = new Set(["no", "n", "false", "0", "excl", "exclusive", "net"]);

/** "" → shop default; a known word → its answer; anything else → undefined (refuse the row). */
export function parseBasis(raw: string | undefined): PriceBasis | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return null;
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  return undefined;
}

const has = (r: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(r, k);

/** The key import_products finds a row's product by: SKU when it has one, else the name. */
export function rowKey(r: Record<string, string>): string | null {
  const sku = (r.sku ?? "").trim();
  if (sku) return `s:${sku}`;
  const name = (r.name ?? "").trim().toLowerCase();
  return name ? `n:${name}` : null;
}

export function planPriceBasis(rows: Record<string, string>[]): VatPlan {
  // No column at all → exactly the one call every import always made.
  if (!rows.some((r) => has(r, "price_includes_vat"))) return { groups: [{ basis: null, rows }], errors: [] };

  const errors: VatRowError[] = [];
  const parsed: { row: Record<string, string>; basis: PriceBasis }[] = [];
  for (const row of rows) {
    const basis = parseBasis(row.price_includes_vat);
    if (basis === undefined) {
      errors.push({
        sku: (row.sku ?? "").trim() || undefined,
        name: (row.name ?? "").trim() || undefined,
        error: `price_includes_vat "${(row.price_includes_vat ?? "").trim()}" is not understood — use yes or no (blank = the shop's default). Row not imported.`,
      });
      continue;
    }
    parsed.push({ row, basis });
  }

  // One product, two answers = two prices fighting over it; the last call would silently win.
  const seen = new Map<string, PriceBasis>();
  const clash = new Set<string>();
  for (const { row, basis } of parsed) {
    const k = rowKey(row);
    if (!k) continue;
    if (seen.has(k) && seen.get(k) !== basis) clash.add(k);
    else seen.set(k, basis);
  }

  const buckets = new Map<PriceBasis, Record<string, string>[]>();
  for (const { row, basis } of parsed) {
    const k = rowKey(row);
    if (k && clash.has(k)) {
      errors.push({
        sku: (row.sku ?? "").trim() || undefined,
        name: (row.name ?? "").trim() || undefined,
        error: "this product appears more than once with different price_includes_vat answers. Row not imported.",
      });
      continue;
    }
    const list = buckets.get(basis) ?? [];
    list.push(row);
    buckets.set(basis, list);
  }
  const groups: VatGroup[] = [];
  for (const basis of [null, true, false] as PriceBasis[]) {
    const list = buckets.get(basis);
    if (list?.length) groups.push({ basis, rows: list });
  }
  return { groups, errors };
}

/**
 * import_products stores a NET selling_price and leaves products.price_includes_vat alone. A product
 * flagged price_includes_vat (20260812000030) holds its exact GROSS in selling_price — so a net price
 * written over it would be read as gross and sell Rs 1,150 as Rs 1,000. After an import the flag must
 * be cleared on every product the sheet really repriced.
 *
 * A row counts only when it carried a selling_price and import_products did not report an error for
 * it (an errored row wrote nothing, so its flag stays with its old price).
 */
export interface RepricedRow { sku: string; name: string }

export function repricedRows(
  rows: Record<string, string>[],
  errors: { sku?: string; name?: string }[],
): RepricedRow[] {
  const failed = new Set(errors.map((e) => `${(e.sku ?? "").trim()}\u0000${(e.name ?? "").trim()}`));
  const out: RepricedRow[] = [];
  for (const r of rows) {
    if ((r.selling_price ?? "").trim() === "") continue;
    const sku = (r.sku ?? "").trim();
    const name = (r.name ?? "").trim();
    if (!sku && !name) continue; // import_products skips it
    if (failed.has(`${sku}\u0000${name}`)) continue;
    out.push({ sku, name });
  }
  return out;
}

/**
 * Which products to unflag: flagged products the sheet repriced. A SKU is unique, so it resolves
 * exactly. A name-only row resolves only when exactly one product has that name — import_products
 * picks an arbitrary one of several, so guessing could unflag the wrong product (which would then
 * sell its exact gross as if it were net).
 */
export function productsToUnflag(
  repriced: RepricedRow[],
  products: { id: string; sku: string | null; name: string; price_includes_vat: boolean }[],
): string[] {
  const bySku = new Map<string, (typeof products)[number]>();
  const byName = new Map<string, (typeof products)[number][]>();
  for (const p of products) {
    if (p.sku && !bySku.has(p.sku)) bySku.set(p.sku, p);
    const k = p.name.trim().toLowerCase();
    if (k) byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const ids = new Set<string>();
  for (const r of repriced) {
    let p: (typeof products)[number] | undefined;
    if (r.sku) p = bySku.get(r.sku);
    else {
      const same = byName.get(r.name.toLowerCase()) ?? [];
      if (same.length === 1) p = same[0];
    }
    if (p?.price_includes_vat) ids.add(p.id);
  }
  return [...ids];
}
