/** A tyre size as the trade writes it: 195/65 R15 → width 195, profile 65, rim 15. */
export interface TyreSize {
  width: number;
  profile: number;
  rim: number;
}

// 195/65R15, 195/65 R15, 195/65ZR15, 195 65 R 15, 225/45-17 — width, profile, optional
// construction letter, rim. Width 125–355 and rim 10–24 keep part numbers from matching.
const SIZE = /\b(1[2-9]\d|2\d\d|3[0-5]\d)\s*[/ ]\s*(\d{2})\s*(?:[A-Z]{0,2}\s*R|-)\s*(1\d|2[0-4])\b/i;
// The load index + speed rating that follows a size: "91H", "102V".
const LOAD = /^\s*(?:XL\s*)?(\d{2,3}[A-Z])\b/i;

export function parseTyreSize(text: string | null | undefined): TyreSize | null {
  const m = SIZE.exec(text ?? "");
  return m ? { width: Number(m[1]), profile: Number(m[2]), rim: Number(m[3]) } : null;
}

export function formatTyreSize(s: TyreSize): string {
  return `${s.width}/${s.profile} R${s.rim}`;
}

export function sameSize(a: TyreSize | null, b: TyreSize | null): boolean {
  return !!a && !!b && a.width === b.width && a.profile === b.profile && a.rim === b.rim;
}

export interface TyreName {
  /** First word: the maker, shown in mono capitals. */
  brand: string;
  /** What is left once brand, size and load index are taken out. */
  model: string;
  size: TyreSize;
  /** "91H", if the name carries one. */
  load: string | null;
}

/** Split a catalogue tyre name ("Bridgestone Ecopia EP150 195/65R15 91H") into the parts
 *  the tile shows. Null when the name holds no size — it is not a tyre. */
export function parseTyreName(name: string): TyreName | null {
  const m = SIZE.exec(name);
  if (!m) return null;
  const before = name.slice(0, m.index).trim();
  const after = name.slice(m.index + m[0].length);
  const load = LOAD.exec(after);
  const rest = (load ? after.slice(load[0].length) : after).trim();
  const words = before.split(/\s+/).filter(Boolean);
  // One word before the size is the maker when the model follows the size ("Michelin
  // 195/65R15 Energy Saver+"), and the model itself when nothing does ("Ecopia 195/65R15").
  const hasBrand = words.length > 1 || (words.length === 1 && rest.length > 0);
  const brand = hasBrand ? words[0] : "";
  const model = [(hasBrand ? words.slice(1) : words).join(" "), rest].filter(Boolean).join(" ").trim();
  return {
    brand,
    model: model || name.trim(),
    size: { width: Number(m[1]), profile: Number(m[2]), rim: Number(m[3]) },
    load: load ? load[1].toUpperCase() : null,
  };
}

export type SaleCategory = "tyres" | "parts" | "services";

/** Where a catalogue item sits on the New sale chips. A tyre is anything filed under a tyre
 *  category or carrying a size in its name. */
export function saleCategory(p: { kind: string; name: string; category: string | null }): SaleCategory {
  if (p.kind === "service") return "services";
  if (/\btyres?\b|\btires?\b/i.test(p.category ?? "") || parseTyreSize(p.name)) return "tyres";
  return "parts";
}
