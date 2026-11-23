import { formatTyreSpec, productSearchMatches, sizeFromColumns, type TyreSize } from "./tyre-size";

/** The brand + tyre-size columns (20261127000010), for a products select list. */
export const ATTR_SELECT = "brand, tyre_width, tyre_profile, tyre_rim, tyre_load_index, tyre_speed_rating";

/** What a product picker needs to show and search brand and size. */
export interface ProductAttrs {
  brand?: string | null;
  tyreSize?: TyreSize | null;
  tyreLoadIndex?: string | null;
  tyreSpeedRating?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attrsFromRow(p: any): Required<ProductAttrs> {
  return {
    brand: p?.brand ?? null,
    tyreSize: sizeFromColumns(p?.tyre_width, p?.tyre_profile, p?.tyre_rim),
    tyreLoadIndex: p?.tyre_load_index ?? null,
    tyreSpeedRating: p?.tyre_speed_rating ?? null,
  };
}

/** "Michelin · 205/55 R16 91V" — the line pickers show under a product's name; "" for neither. */
export function attrLabel(p: ProductAttrs): string {
  return [p.brand, p.tyreSize ? formatTyreSpec(p.tyreSize, p.tyreLoadIndex, p.tyreSpeedRating) : null].filter(Boolean).join(" · ");
}

/** The pickers' search over a product's own words plus its brand and size. */
export function pickerMatches(q: string, words: (string | null | undefined)[], p: ProductAttrs): boolean {
  return productSearchMatches(q, words, { brand: p.brand ?? null, size: p.tyreSize ?? null, loadIndex: p.tyreLoadIndex, speedRating: p.tyreSpeedRating });
}
