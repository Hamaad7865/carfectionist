import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { toCsv, type CsvColumn } from "@/lib/csv";
import { grossCents } from "@/lib/money";
import { formatTyreSize, isTyreCategory, sizeFromColumns } from "@/lib/products/tyre-size";

const slug = (s: string) => "stock_" + s.trim().toLowerCase().replace(/\s+/g, "_");

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const sb = await createClient();
  const [prodData, ohData, locRes, bsRes, coRes] = await Promise.all([
    fetchAllRows(() => sb.from("products").select("id, sku, name, category, barcode, unit, selling_price, price_includes_vat, cost_price, vat_rate, low_stock_threshold, is_active, legal_entity_id, brand, tyre_width, tyre_profile, tyre_rim, tyre_load_index, tyre_speed_rating").order("name")),
    fetchAllRows(() => sb.from("stock_on_hand").select("product_id, location_id, qty_on_hand"), ["product_id", "location_id"]),
    sb.from("stock_locations").select("id, name, is_default").order("is_default", { ascending: false }),
    sb.from("business_settings").select("vat_rate, prices_vat_exclusive").limit(1),
    sb.from("legal_entities").select("id, legal_name, is_default").eq("is_active", true).order("sort_order"),
  ]);
  // sold_by appears only for a shop with several companies; import_products reads it back by name.
  const companies = (coRes.data ?? []) as { id: string; legal_name: string; is_default: boolean }[];
  const multiCompany = companies.length > 1;
  const mainName = companies.find((c) => c.is_default)?.legal_name ?? "";
  const soldBy = (id: string | null) => (id ? companies.find((c) => c.id === id)?.legal_name : null) ?? mainName;

  // A gross-quoting shop reads and writes SHELF prices everywhere — the sheet included.
  // import_products divides the same figure back to net (migration 0040), so
  // export → edit → import round-trips losslessly. A net-quoting shop exports net, as before.
  //
  // A price_includes_vat product (20260812000030) already stores the EXACT shelf gross, so it
  // exports verbatim — no re-grossing, which would push its 9,900 to 9,900.01. Caveat: import
  // still divides gross→net and does not carry the flag back, so a CSV round-trip reverts a
  // flagged product to net (and its cent of drift) until the owner re-saves it in the form.
  const bs = (bsRes.data ?? [])[0] as { vat_rate: number | null; prices_vat_exclusive: boolean } | undefined;
  const grossQuoting = bs?.prices_vat_exclusive === false;
  const vatDefault = Number(bs?.vat_rate ?? 15);
  const sheetPrice = (val: unknown, rate: unknown, inclusive: boolean): string | unknown => {
    if (val == null) return "";
    if (inclusive) return Number(val).toFixed(2);   // selling_price IS the shelf gross, as typed
    if (!grossQuoting) return val;                  // net-quoting shop exports net, as before
    return (grossCents(Math.round(Number(val) * 100), Number(rate ?? vatDefault)) / 100).toFixed(2);
  };

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

  // brand appears once any product has one (or the shop sells tyres); the tyre columns once the
  // shop has sized a product or files anything under a tyre-like category — so a tyre shop loading
  // its range through the sheet sees them on its very first export, and a shop that uses neither
  // (Carfectionist today) keeps exactly the sheet it always had.
  // The import reads all four back (features/dataio/actions.ts → applyImportedAttrs).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasSizes = (prodData as any[]).some((p) => p.tyre_width != null || isTyreCategory(p.category));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasBrands = hasSizes || (prodData as any[]).some((p) => (p.brand ?? "").trim() !== "");
  const baseCols: CsvColumn[] = [
    { key: "sku", header: "sku" },
    { key: "name", header: "name" },
    { key: "category", header: "category" },
    ...(hasBrands ? [{ key: "brand", header: "brand" }] : []),
    ...(hasSizes
      ? [
          { key: "tyre_size", header: "tyre_size" },
          { key: "load_index", header: "load_index" },
          { key: "speed_rating", header: "speed_rating" },
        ]
      : []),
    { key: "barcode", header: "barcode" },
    { key: "unit", header: "unit" },
    { key: "selling_price", header: "selling_price" },
    { key: "price_includes_vat", header: "price_includes_vat" },
    { key: "cost_price", header: "cost_price" },
    { key: "vat_rate", header: "vat_rate" },
    { key: "low_stock_threshold", header: "low_stock_threshold" },
    { key: "is_active", header: "is_active" },
    ...(multiCompany ? [{ key: "sold_by", header: "sold_by" }] : []),
  ];
  const stockCols: CsvColumn[] = locs.map((l) => ({ key: l.col, header: l.col }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (prodData as any[]).map((p) => {
    const oh = ohByProduct.get(p.id) ?? {};
    const row: Record<string, unknown> = {
      sku: p.sku ?? "",
      name: p.name ?? "",
      category: p.category ?? "",
      brand: p.brand ?? "",
      barcode: p.barcode ?? "",
      unit: p.unit ?? "",
      selling_price: sheetPrice(p.selling_price, p.vat_rate, p.price_includes_vat === true),
      // What the price in this row means. A gross-quoting shop (and any flagged product) exports shelf
      // prices = "yes"; a net-quoting shop exports net = "no". Importing the sheet back therefore reads
      // every price exactly the way it was written.
      price_includes_vat: p.price_includes_vat === true || grossQuoting ? "yes" : "no",
      cost_price: p.cost_price ?? "",
      vat_rate: p.vat_rate ?? "",
      low_stock_threshold: p.low_stock_threshold ?? "",
      is_active: p.is_active ? "yes" : "no",
    };
    if (hasSizes) {
      const size = sizeFromColumns(p.tyre_width, p.tyre_profile, p.tyre_rim);
      row.tyre_size = size ? formatTyreSize(size) : "";
      row.load_index = p.tyre_load_index ?? "";
      row.speed_rating = p.tyre_speed_rating ?? "";
    }
    if (multiCompany) row.sold_by = soldBy(p.legal_entity_id ?? null);
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
