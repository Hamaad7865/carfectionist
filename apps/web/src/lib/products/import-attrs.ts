import { attrColumns, type AttrColumns } from "./attr-columns";

/**
 * The brand / tyre_size / load_index / speed_rating columns of a product spreadsheet.
 *
 * import_products (PL/pgSQL) writes named columns only and does not know these, so the import
 * action applies them afterwards, finding each row's product exactly as import_products does:
 * by SKU when the row has one, otherwise by name (case-insensitive). A column the sheet does
 * not have leaves the product's value alone; a blank cell clears it.
 */
export interface AttrUpdate {
  sku: string;
  name: string;
  columns: Partial<AttrColumns>;
}

export interface AttrPlan {
  updates: AttrUpdate[];
  errors: { sku?: string; name?: string; error: string }[];
}

const has = (r: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(r, k);

export function planImportedAttrs(rows: Record<string, string>[]): AttrPlan {
  const plan: AttrPlan = { updates: [], errors: [] };
  for (const r of rows) {
    const withBrand = has(r, "brand");
    const withSize = has(r, "tyre_size");
    if (!withBrand && !withSize) continue;
    const sku = (r.sku ?? "").trim();
    const name = (r.name ?? "").trim();
    if (!sku && !name) continue; // import_products skips it too

    const res = attrColumns({
      brand: r.brand,
      tyreSize: withSize ? r.tyre_size : "",
      loadIndex: withSize ? r.load_index : "",
      speedRating: withSize ? r.speed_rating : "",
    });
    if (!res.ok) {
      plan.errors.push({ sku: sku || undefined, name: name || undefined, error: res.error });
      continue;
    }
    const c = res.columns;
    const columns: Partial<AttrColumns> = {};
    if (withBrand) columns.brand = c.brand;
    if (withSize) {
      columns.tyre_width = c.tyre_width;
      columns.tyre_profile = c.tyre_profile;
      columns.tyre_rim = c.tyre_rim;
      columns.tyre_load_index = c.tyre_load_index;
      columns.tyre_speed_rating = c.tyre_speed_rating;
    }
    plan.updates.push({ sku, name, columns });
  }
  return plan;
}

/** Find an imported row's product the way import_products does: SKU first; name only when the
 *  row has no SKU. The maps hold the first product seen per key. */
export function resolveImportedRow(
  u: Pick<AttrUpdate, "sku" | "name">,
  bySku: Map<string, string>,
  byName: Map<string, string>,
): string | null {
  if (u.sku) return bySku.get(u.sku) ?? null;
  return u.name ? (byName.get(u.name.toLowerCase()) ?? null) : null;
}
