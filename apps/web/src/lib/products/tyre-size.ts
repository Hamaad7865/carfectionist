/**
 * Brand + tyre size: the parsing, matching and size↔brand summaries shared by the product
 * form, the catalogue filter, the line pickers and the import (20261127000010).
 *
 * Mirrored line for line by the tablet's core/catalog/TyreSize.kt; both are held to
 * tyre-size.fixture.json, which the vitest suite and the JUnit suite each read.
 */

/** A tyre size as the trade writes it: 205/55 R16 → width 205, profile 55, rim 16. */
export interface TyreSize {
  width: number;
  profile: number;
  /** Inches. 17.5 / 19.5 / 22.5 exist on light-truck tyres. */
  rim: number;
}

/** What someone typed into a size box: any part left out matches everything. */
export interface SizeQuery {
  width: number | null;
  profile: number | null;
  rim: number | null;
}

/** A size written out in full, with whatever follows it on the sidewall. */
export interface TyreSpec {
  size: TyreSize;
  loadIndex: string | null;
  speedRating: string | null;
}

// Plausible ranges — wide enough for every car, 4x4 and light-truck tyre, narrow enough that
// a part number or a price is never read as a size.
export const WIDTH_MIN = 125, WIDTH_MAX = 355;
export const PROFILE_MIN = 25, PROFILE_MAX = 95;
export const RIM_MIN = 10, RIM_MAX = 24;

const okWidth = (n: number) => Number.isInteger(n) && n >= WIDTH_MIN && n <= WIDTH_MAX;
const okProfile = (n: number) => Number.isInteger(n) && n >= PROFILE_MIN && n <= PROFILE_MAX;
const okRim = (n: number) => n >= RIM_MIN && n <= RIM_MAX && (Number.isInteger(n) || n % 1 === 0.5);

export function isValidSize(s: TyreSize): boolean {
  return okWidth(s.width) && okProfile(s.profile) && okRim(s.rim);
}

// 205/55R16, 205/55 R16, 225/45ZR17, 205 55 R 16, 225/45-17, 215/75 R17.5 — width, profile,
// optional construction letters, rim.
const FULL = /(?<![\d.])(\d{3})\s*[/ ]\s*(\d{2})\s*(?:[A-Z]{0,2}\s*R\s*|-)(\d{2}(?:[.,]5)?)(?![\d])/i;
// The load index + speed rating that follows a size: "91H", "XL 102V", "121/119R".
const LOAD = /^\s*(?:XL\s+|RF\s+|C\s+)?(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])(?![A-Z])/i;

const rimNum = (s: string) => Number(s.replace(",", "."));

/** The first full size written anywhere in a piece of text, or null. */
export function parseTyreSize(text: string | null | undefined): TyreSize | null {
  return parseTyreSpec(text)?.size ?? null;
}

/** A full size plus the load index / speed rating after it, from a product name such as
 *  "Michelin Primacy 4 205/55R16 91V". Pre-fills the form — never the source of truth. */
export function parseTyreSpec(text: string | null | undefined): TyreSpec | null {
  const t = text ?? "";
  const m = FULL.exec(t);
  if (!m) return null;
  const size = { width: Number(m[1]), profile: Number(m[2]), rim: rimNum(m[3]) };
  if (!isValidSize(size)) return null;
  const load = LOAD.exec(t.slice(m.index + m[0].length));
  return {
    size,
    loadIndex: load ? load[1] : null,
    speedRating: load ? load[2].toUpperCase() : null,
  };
}

/**
 * Read a size box, partially typed or not: "205", "205/55", "205/55 R16", "205/55R16",
 * "205 55 16", "205-55-16", "2055516", "R16", "16" never (two digits alone are ambiguous).
 * Returns null when the text is not a size at all — the caller then treats it as words.
 * A half-typed trailing part ("205/5") is ignored rather than failing the whole query.
 */
export function parseSizeQuery(text: string | null | undefined): SizeQuery | null {
  let s = (text ?? "").trim().toUpperCase();
  if (!s) return null;
  // Only digits, separators and the construction letters belong in a size.
  if (!/^[\d\s/.,\-ZR]+$/.test(s)) return null;

  let rim: number | null = null;
  const r = /Z?R\s*(\d{0,2}(?:[.,]5?)?)\s*$/.exec(s);
  if (r) {
    const digits = r[1].replace(/[.,]$/, "");
    if (/^\d{2}([.,]5)?$/.test(digits)) {
      rim = rimNum(digits);
      if (!okRim(rim)) return null;
    }
    s = s.slice(0, r.index).trim();
  }
  if (/[ZR]/.test(s)) return null;

  const groups = s.split(/[\s/\-]+/).filter(Boolean);
  if (groups.some((g) => !/^\d+([.,]5)?$/.test(g))) return null;

  let width: number | null = null;
  let profile: number | null = null;

  // Typed without separators: 2055516 / 20555.
  if (groups.length === 1 && /^\d{5}$|^\d{7}$/.test(groups[0])) {
    const g = groups[0];
    groups.splice(0, 1, g.slice(0, 3), g.slice(3, 5), ...(g.length === 7 ? [g.slice(5)] : []));
  }
  if (groups.length > 3) return null;

  if (groups.length >= 1) {
    const g = groups[0];
    if (g.length < 3) return null; // "20" is a width still being typed — not a size yet
    width = Number(g);
    if (!okWidth(width)) return null;
  }
  if (groups.length >= 2) {
    const g = groups[1];
    if (g.length === 2) {
      profile = Number(g);
      if (!okProfile(profile)) return null;
    } else if (g.length !== 1 || groups.length > 2) {
      return null; // "205/5" is still being typed (allowed only as the last part)
    }
  }
  if (groups.length === 3) {
    if (rim != null) return null; // "205 55 16 R16"
    const g = groups[2];
    if (/^\d{2}([.,]5)?$/.test(g)) {
      rim = rimNum(g);
      if (!okRim(rim)) return null;
    } else if (g.length !== 1) {
      return null;
    }
  }
  if (width == null && profile == null && rim == null) return null;
  return { width, profile, rim };
}

export const isSizeQuerySet = (q: SizeQuery | null): q is SizeQuery =>
  !!q && (q.width != null || q.profile != null || q.rim != null);

/** Does a product's stored size satisfy a (partial) size query? No size never matches. */
export function sizeMatches(size: TyreSize | null, q: SizeQuery): boolean {
  if (!size) return false;
  return (q.width == null || size.width === q.width)
    && (q.profile == null || size.profile === q.profile)
    && (q.rim == null || size.rim === q.rim);
}

const rimText = (rim: number) => (Number.isInteger(rim) ? String(rim) : rim.toFixed(1));

export function formatTyreSize(s: TyreSize): string {
  return `${s.width}/${s.profile} R${rimText(s.rim)}`;
}

/** "205/55 R16 91V" — the size and whatever load/speed the product carries. */
export function formatTyreSpec(size: TyreSize, loadIndex?: string | null, speedRating?: string | null): string {
  const ls = `${loadIndex ?? ""}${speedRating ?? ""}`.trim();
  return ls ? `${formatTyreSize(size)} ${ls}` : formatTyreSize(size);
}

/** What a partial query reads back as, for chips and headings: "205/55", "R16", "205/55 R16". */
export function formatSizeQuery(q: SizeQuery): string {
  const head = [q.width, q.profile].filter((n) => n != null).join("/");
  const rim = q.rim != null ? `R${rimText(q.rim)}` : "";
  return [head, rim].filter(Boolean).join(" ");
}

export function sizeFromColumns(width: unknown, profile: unknown, rim: unknown): TyreSize | null {
  if (width == null || profile == null || rim == null) return null;
  const s = { width: Number(width), profile: Number(profile), rim: Number(rim) };
  return Number.isFinite(s.width) && Number.isFinite(s.profile) && Number.isFinite(s.rim) ? s : null;
}

// ── Brand ───────────────────────────────────────────────────────────────────

/** Trim and collapse inner spaces; blank → null. The spelling is otherwise kept as typed. */
export function normaliseBrand(b: string | null | undefined): string | null {
  const s = (b ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
}

/** The grouping key: "MICHELIN", "Michelin " and "michelin" are one brand. "" = no brand. */
export function brandKey(b: string | null | undefined): string {
  return (normaliseBrand(b) ?? "").toLowerCase();
}

// ── Which products carry a size ─────────────────────────────────────────────

const TYRE_CATEGORY = /\b(tyres?|tires?|pneus?|pneumatiques?|wheels?|jantes?|roues?)\b/i;

/** A category that holds tyres/wheels: Tyres, Tires, Pneus, Wheels, Jantes… */
export function isTyreCategory(category: string | null | undefined): boolean {
  return TYRE_CATEGORY.test(category ?? "");
}

/** The form shows the size fields for goods filed under a tyre-like category, and for any
 *  product that already has a size (so moving it to another category never hides one). */
export function showsTyreFields(p: { kind: string; category: string | null | undefined; hasSize?: boolean }): boolean {
  if (p.kind === "service") return false;
  return isTyreCategory(p.category) || !!p.hasSize;
}

// ── Size ↔ brand summaries ──────────────────────────────────────────────────

export interface AttrItem {
  brand: string | null;
  size: TyreSize | null;
  /** Stock to count for this product; null when it is not stocked. */
  qty: number | null;
}

export interface BrandRow {
  key: string;
  /** The spelling most products use ("" = no brand recorded). */
  brand: string;
  products: number;
  qty: number;
}

export interface SizeRow {
  size: TyreSize;
  label: string;
  products: number;
  qty: number;
}

/** The most common spelling of each brand key, ties to the alphabetically first. */
function spellings(items: AttrItem[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const i of items) {
    const b = normaliseBrand(i.brand);
    if (!b) continue;
    const k = b.toLowerCase();
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    counts.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
    out.set(k, best);
  }
  return out;
}

const byLabel = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);

/** Every brand in a list, for the brand picker / autocomplete, A→Z. */
export function brandOptions(items: AttrItem[]): BrandRow[] {
  const sp = spellings(items);
  const rows = new Map<string, BrandRow>();
  for (const i of items) {
    const k = brandKey(i.brand);
    if (!k) continue;
    const r = rows.get(k) ?? { key: k, brand: sp.get(k) ?? k, products: 0, qty: 0 };
    r.products += 1;
    r.qty += i.qty ?? 0;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => byLabel(a.brand, b.brand));
}

/** "I typed 205/55 — which brands do I have?" One row per brand among the products whose size
 *  matches, most stock first; products with no brand recorded come last as brand "". */
export function brandsForSize(items: AttrItem[], q: SizeQuery): BrandRow[] {
  const sp = spellings(items);
  const rows = new Map<string, BrandRow>();
  for (const i of items) {
    if (!sizeMatches(i.size, q)) continue;
    const k = brandKey(i.brand);
    const r = rows.get(k) ?? { key: k, brand: k ? (sp.get(k) ?? k) : "", products: 0, qty: 0 };
    r.products += 1;
    r.qty += i.qty ?? 0;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) =>
    (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0) || b.qty - a.qty || b.products - a.products || byLabel(a.brand, b.brand));
}

const sizeOrder = (a: TyreSize, b: TyreSize) => a.rim - b.rim || a.width - b.width || a.profile - b.profile;

/** "I picked Michelin — which sizes does it come in?" One row per size, smallest rim first.
 *  Products of that brand without a size are not listed (they are not tyres). */
export function sizesForBrand(items: AttrItem[], key: string): SizeRow[] {
  const rows = new Map<string, SizeRow>();
  for (const i of items) {
    if (!i.size || brandKey(i.brand) !== key) continue;
    const label = formatTyreSize(i.size);
    const r = rows.get(label) ?? { size: i.size, label, products: 0, qty: 0 };
    r.products += 1;
    r.qty += i.qty ?? 0;
    rows.set(label, r);
  }
  return [...rows.values()].sort((a, b) => sizeOrder(a.size, b.size));
}

/** One product against the catalogue's brand + size filters. */
export function matchesAttrFilter(i: Pick<AttrItem, "brand" | "size">, f: { brandKey: string; size: SizeQuery | null }): boolean {
  if (f.brandKey && brandKey(i.brand) !== f.brandKey) return false;
  if (isSizeQuerySet(f.size) && !sizeMatches(i.size, f.size)) return false;
  return true;
}

/** The words a free-text search should also find a product by: its brand and its size in the
 *  common spellings (205/55 R16, 205/55R16, 2055516), so "michelin 205/55" finds it. */
export function attrSearchText(brand: string | null, size: TyreSize | null, loadIndex?: string | null, speedRating?: string | null): string {
  const parts: string[] = [];
  if (brand) parts.push(brand);
  if (size) {
    const r = rimText(size.rim);
    parts.push(formatTyreSpec(size, loadIndex, speedRating), `${size.width}/${size.profile}R${r}`, `${size.width}${size.profile}${r}`);
  }
  return parts.join(" ").toLowerCase();
}

/**
 * The pickers' search: every word typed must be found — in the product's own words (name,
 * barcode, SKU…), its brand, its size in any common spelling, or, read as a partial size,
 * match its stored size. So "michelin 205/55", "205/55 r16" and "2055516" all find a
 * Michelin 205/55 R16; a plain "wax" search behaves as it always did.
 */
export function productSearchMatches(
  query: string,
  words: (string | null | undefined)[],
  attrs: { brand: string | null; size: TyreSize | null; loadIndex?: string | null; speedRating?: string | null },
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [...words.map((w) => (w ?? "").toLowerCase()), attrSearchText(attrs.brand, attrs.size, attrs.loadIndex, attrs.speedRating)].join("\n");
  return tokens.every((t) => {
    if (hay.includes(t)) return true;
    const s = parseSizeQuery(t);
    return isSizeQuerySet(s) && sizeMatches(attrs.size, s);
  });
}
