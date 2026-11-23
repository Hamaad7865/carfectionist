import { normaliseBrand, parseSizeQuery } from "./tyre-size";

/** The products columns added by 20261127000010, as the product form and the import write them. */
export interface AttrColumns {
  brand: string | null;
  tyre_width: number | null;
  tyre_profile: number | null;
  tyre_rim: number | null;
  tyre_load_index: string | null;
  tyre_speed_rating: string | null;
}

export interface AttrInput {
  brand?: string | null;
  /** "205/55 R16", "205/55R16", "205 55 16", "2055516"; blank = not a tyre. */
  tyreSize?: string | null;
  loadIndex?: string | null;
  speedRating?: string | null;
}

export const NO_TYRE = { tyre_width: null, tyre_profile: null, tyre_rim: null, tyre_load_index: null, tyre_speed_rating: null } as const;

/**
 * Validate and convert what was typed into the brand / size boxes (or a spreadsheet's columns)
 * into column values. A load index or speed rating without a size is refused rather than kept
 * orphaned; a service never carries a size.
 */
export function attrColumns(input: AttrInput, kind?: string): { ok: true; columns: AttrColumns } | { ok: false; error: string } {
  const brand = normaliseBrand(input.brand);
  if (brand && brand.length > 60) return { ok: false, error: "Brand is too long (60 characters at most)." };

  const sizeText = (input.tyreSize ?? "").trim();
  const load = (input.loadIndex ?? "").trim();
  const speed = (input.speedRating ?? "").trim().toUpperCase();

  if (!sizeText) {
    if (load || speed) return { ok: false, error: "Enter the tyre size before its load index or speed rating." };
    return { ok: true, columns: { brand, ...NO_TYRE } };
  }
  if (kind === "service") return { ok: false, error: "A service has no tyre size." };

  const q = parseSizeQuery(sizeText);
  if (!q || q.width == null || q.profile == null || q.rim == null) {
    return { ok: false, error: `"${sizeText}" is not a full tyre size — write it like 205/55 R16.` };
  }
  if (load && !/^\d{2,3}(\/\d{2,3})?$/.test(load)) return { ok: false, error: "Load index should look like 91 or 121/119." };
  if (speed && !/^[A-Z]$/.test(speed)) return { ok: false, error: "Speed rating is one letter, like H or V." };

  return {
    ok: true,
    columns: {
      brand,
      tyre_width: q.width,
      tyre_profile: q.profile,
      tyre_rim: q.rim,
      tyre_load_index: load || null,
      tyre_speed_rating: speed || null,
    },
  };
}
