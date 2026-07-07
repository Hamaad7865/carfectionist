import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";

export interface CategoryStat {
  name: string; // exact stored value
  total: number;
  active: number;
  archived: number;
}
export interface CategoriesData {
  categories: CategoryStat[];
  uncategorised: number; // products with null/blank category
}

/** Categories are a plain text column on products (no lookup table), so a
 *  category "exists" only as long as some product carries the exact string.
 *  We group by the exact value (not trimmed) so near-duplicates like
 *  "Wax" / "Wax " surface as separate rows the manager can merge. */
export async function getCategoryStats(): Promise<CategoriesData> {
  const sb = await createClient();
  const rows = await fetchAllRows(() => sb.from("products").select("category, is_active"));

  const map = new Map<string, { total: number; active: number; archived: number }>();
  let uncategorised = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rows as any[]) {
    const raw: string | null = r.category;
    if (raw == null || raw.trim() === "") { uncategorised++; continue; }
    const e = map.get(raw) ?? { total: 0, active: 0, archived: 0 };
    e.total++;
    if (r.is_active) e.active++; else e.archived++;
    map.set(raw, e);
  }
  const categories = [...map.entries()]
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { categories, uncategorised };
}
