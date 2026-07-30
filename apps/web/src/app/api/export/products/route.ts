import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { toCsv, type CsvColumn } from "@/lib/csv";
import { grossCents } from "@/lib/money";

const slug = (s: string) => "stock_" + s.trim().toLowerCase().replace(/\s+/g, "_");

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const sb = await createClient();
  const [prodData, ohData, locRes, bsRes] = await Promise.all([
    fetchAllRows(() => sb.from("products").select("id, sku, name, category, barcode, unit, selling_price, cost_price, vat_rate, low_stock_threshold, is_active").order("name")),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
    sb.from("stock_locations").select("id, name, is_default").order("is_default", { ascending: false }),
    sb.from("business_settings").select("vat_rate, prices_vat_exclusive").limit(1),
  ]);

  // A gross-quoting shop reads and writes SHELF prices everywhere — the sheet included.
  // import_products divides the same figure back to net (migration 0040), so
  // export → edit → import round-trips losslessly. A net-quoting shop exports net, as before.
  const bs = (bsRes.data ?? [])[0] as { vat_rate: number | null; prices_vat_exclusive: boolean } | undefined;
  const grossQuoting = bs?.prices_vat_exclusive === false;
  const vatDefault = Number(bs?.vat_rate ?? 15);
  const sheetPrice = (net: unknown, rate: unknown): string | unknown =>
    net == null || !grossQuoting
      ? net ?? ""
      : (grossCents(Math.round(Number(net) * 100), Number(rate ?? vatDefault)) / 100).toFixed(2);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locs = ((locRes.data ?? []) as any[]).map((l) => ({ id: l.id, col: slug(l.name) }));
  // product_id -> { <stock_col>: qty }
  const ohByProduct = new Map<string, Record<string, number>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ohData as any[]) {
    const col = locs.find((l) => l.id === r.location_id)?.col;
    if (!col) continue;
    const m = ohByProduct.get(r.product_id) ?? {};
    m[col] = Number(r.qty_on_hand);
    ohByProduct.set(r.product_id, m);
  }

  const baseCols: CsvColumn[] = [
    { key: "sku", header: "sku" },
    { key: "name", header: "name" },
    { key: "category", header: "category" },
    { key: "barcode", header: "barcode" },
    { key: "unit", header: "unit" },
    { key: "selling_price", header: "selling_price" },
    { key: "cost_price", header: "cost_price" },
    { key: "vat_rate", header: "vat_rate" },
    { key: "low_stock_threshold", header: "low_stock_threshold" },
    { key: "is_active", header: "is_active" },
  ];
  const stockCols: CsvColumn[] = locs.map((l) => ({ key: l.col, header: l.col }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (prodData as any[]).map((p) => {
    const oh = ohByProduct.get(p.id) ?? {};
    const row: Record<string, unknown> = {
      sku: p.sku ?? "",
      name: p.name ?? "",
      category: p.category ?? "",
      barcode: p.barcode ?? "",
      unit: p.unit ?? "",
      selling_price: sheetPrice(p.selling_price, p.vat_rate),
      cost_price: p.cost_price ?? "",
      vat_rate: p.vat_rate ?? "",
      low_stock_threshold: p.low_stock_threshold ?? "",
      is_active: p.is_active ? "yes" : "no",
    };
    for (const l of locs) row[l.col] = oh[l.col] ?? 0;
    return row;
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows, [...baseCols, ...stockCols]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products-${stamp}.csv"`,
    },
  });
}
