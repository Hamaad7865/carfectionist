import type { CounterProduct } from "@/lib/supabase/queries/counter";
import { parseTyreName, sameSize, saleCategory, type SaleCategory, type TyreName, type TyreSize } from "@/lib/tyrecentre/tyre-size";

export interface CatalogueItem {
  product: CounterProduct;
  category: SaleCategory;
  tyre: TyreName | null;
  sold: number;
}

export type SortKey = "best" | "price" | "name";
export const SORT_LABEL: Record<SortKey, string> = { best: "Best seller", price: "Price", name: "Name" };

/** A tyre-size filter: any part left out matches everything. */
export interface SizeFilter {
  width: number | null;
  profile: number | null;
  rim: number | null;
}
export const ANY_SIZE: SizeFilter = { width: null, profile: null, rim: null };

export function buildCatalogue(products: CounterProduct[], soldQty: Record<string, number>): CatalogueItem[] {
  return products.map((p) => {
    const category = saleCategory(p);
    return { product: p, category, tyre: category === "tyres" ? parseTyreName(p.name) : null, sold: soldQty[p.id] ?? 0 };
  });
}

/** The values each size picker offers: what the catalogue's tyres actually come in. */
export function sizeOptions(items: CatalogueItem[]): { width: number[]; profile: number[]; rim: number[] } {
  const w = new Set<number>(), p = new Set<number>(), r = new Set<number>();
  for (const i of items) {
    if (!i.tyre) continue;
    w.add(i.tyre.size.width);
    p.add(i.tyre.size.profile);
    r.add(i.tyre.size.rim);
  }
  const sort = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { width: sort(w), profile: sort(p), rim: sort(r) };
}

const fitsSize = (t: TyreSize, f: SizeFilter) =>
  (f.width == null || t.width === f.width) && (f.profile == null || t.profile === f.profile) && (f.rim == null || t.rim === f.rim);

/** Search, chip and size together. A size narrows the TYRES only: valves, fitting and
 *  balancing still show, because they go with whatever tyre is chosen. */
export function filterCatalogue(
  items: CatalogueItem[],
  opts: { q: string; category: SaleCategory | "all"; size: SizeFilter; sort: SortKey },
): CatalogueItem[] {
  const q = opts.q.trim().toLowerCase();
  const sizing = opts.size.width != null || opts.size.profile != null || opts.size.rim != null;
  const out = items.filter((i) => {
    if (opts.category !== "all" && i.category !== opts.category) return false;
    if (sizing && i.category === "tyres" && (!i.tyre || !fitsSize(i.tyre.size, opts.size))) return false;
    if (!q) return true;
    return i.product.name.toLowerCase().includes(q) || (i.product.barcode ?? "").toLowerCase().includes(q) || (i.product.category ?? "").toLowerCase().includes(q);
  });
  const by: Record<SortKey, (a: CatalogueItem, b: CatalogueItem) => number> = {
    best: (a, b) => b.sold - a.sold || a.product.name.localeCompare(b.product.name),
    price: (a, b) => a.product.priceCents - b.product.priceCents,
    name: (a, b) => a.product.name.localeCompare(b.product.name),
  };
  return out.sort(by[opts.sort]);
}

export function categoryCounts(items: CatalogueItem[]): Record<SaleCategory | "all", number> {
  const c = { all: items.length, tyres: 0, parts: 0, services: 0 };
  for (const i of items) c[i.category] += 1;
  return c;
}

/** The size of the newest tyre on a car's bills — the "From <plate>" pill. */
export function lastTyreSize(visits: { lines: { title: string }[] }[]): TyreSize | null {
  for (const v of visits) {
    for (const l of v.lines) {
      const t = parseTyreName(l.title);
      if (t) return t.size;
    }
  }
  return null;
}

export const isSizeSet = (f: SizeFilter) => f.width != null || f.profile != null || f.rim != null;
export const sizeFilterEquals = (f: SizeFilter, s: TyreSize | null) =>
  !!s && sameSize({ width: f.width ?? -1, profile: f.profile ?? -1, rim: f.rim ?? -1 }, s);
