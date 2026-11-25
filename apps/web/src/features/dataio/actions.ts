"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import * as rpc from "@/lib/supabase/rpc";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { planImportedAttrs, resolveImportedRow, type AttrPlan } from "@/lib/products/import-attrs";
import { planPriceBasis, productsToUnflag, repricedRows } from "@/lib/products/import-vat";

type ImportReport = rpc.ImportReport;
export type ImportResult = { ok: true; report: rpc.ImportReport } | { ok: false; error: string };

// Row cap so a runaway paste can't jam the RPC / hit param limits.
const MAX_ROWS = 5000;

export async function importCustomersAction(rows: Record<string, string>[], dryRun: boolean): Promise<ImportResult> {
  await requireRole("owner", "manager");
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "No rows found in the file." };
  if (rows.length > MAX_ROWS) return { ok: false, error: `Too many rows (${rows.length}). Split into files of ${MAX_ROWS} or fewer.` };
  const sb = await createClient();
  try {
    const report = await rpc.importCustomers(sb, rows, dryRun);
    if (!dryRun) revalidatePath("/contacts");
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function importProductsAction(rows: Record<string, string>[], dryRun: boolean): Promise<ImportResult> {
  await requireRole("owner", "manager");
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "No rows found in the file." };
  if (rows.length > MAX_ROWS) return { ok: false, error: `Too many rows (${rows.length}). Split into files of ${MAX_ROWS} or fewer.` };
  const sb = await createClient();
  try {
    // brand / tyre_size / load_index / speed_rating (20261127000010) are not import_products'
    // columns: validate them up front so the preview reports a bad size, then set them on the
    // matched products once the rows exist.
    const plan = planImportedAttrs(rows);
    // A price_includes_vat column splits the sheet by answer (one import_products call each); a sheet
    // without it is the single call it always was. A row refused here never reaches the database.
    const vat = planPriceBasis(rows);
    const report: rpc.ImportReport = { inserted: 0, updated: 0, skipped: vat.errors.length, stock_adjusted: 0, errors: [...vat.errors] };
    const rpcErrors: ImportReport["errors"] = [];
    const done: Record<string, string>[] = []; // rows of the calls that finished
    let failure: string | null = null;
    for (const g of vat.groups) {
      try {
        const part = await rpc.importProducts(sb, g.rows, dryRun, g.basis);
        report.inserted += part.inserted ?? 0;
        report.updated += part.updated ?? 0;
        report.skipped += part.skipped ?? 0;
        report.stock_adjusted = (report.stock_adjusted ?? 0) + (part.stock_adjusted ?? 0);
        rpcErrors.push(...(part.errors ?? []));
        done.push(...g.rows);
      } catch (e) {
        failure = (e as Error).message;
        break;
      }
    }
    report.errors.push(...rpcErrors, ...plan.errors);
    if (!dryRun) {
      // Also after a partial run: the calls that did finish already saved their prices.
      if (done.length > 0) await clearStaleVatFlags(sb, done, rpcErrors, report);
      revalidatePath("/products");
    }
    if (failure !== null) {
      return {
        ok: false,
        error: !dryRun && done.length > 0
          ? `The import stopped part-way (${failure}). ${report.inserted + report.updated} product(s) were already saved. Import the same file again to finish — it is safe to repeat.`
          : failure,
      };
    }
    if (!dryRun) report.attrs_set = await applyImportedAttrs(sb, plan, report);
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** import_products writes a NET selling_price and never touches products.price_includes_vat, so a
 *  product flagged as holding its exact gross would be left reading the new net as if it were gross.
 *  Clear the flag on exactly the flagged products this import repriced (`sent` = the rows the database
 *  processed, `rpcErrors` = the rows it refused). A failure here is reported loudly: it leaves the
 *  old state, never a new one. */
async function clearStaleVatFlags(sb: Awaited<ReturnType<typeof createClient>>, sent: Record<string, string>[], rpcErrors: ImportReport["errors"], report: rpc.ImportReport): Promise<void> {
  const repriced = repricedRows(sent, rpcErrors);
  if (repriced.length === 0) return;
  try {
    const all = (await fetchAllRows(() => sb.from("products").select("id, sku, name, price_includes_vat").order("created_at").order("id"))) as {
      id: string; sku: string | null; name: string; price_includes_vat: boolean;
    }[];
    const ids = productsToUnflag(repriced, all);
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await sb.from("products").update({ price_includes_vat: false }).in("id", ids.slice(i, i + CHUNK)).eq("price_includes_vat", true);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    report.errors.push({ error: `Prices were saved, but some products' "price includes VAT" setting could not be reset (${(e as Error).message}). Open those products and re-save their price. Importing the same file again also fixes it.` });
  }
}

/** Write the planned brand/size columns onto the products the import just created or updated.
 *  RLS scopes both the lookup and the updates to the signed-in shop. Returns how many were set. */
async function applyImportedAttrs(sb: Awaited<ReturnType<typeof createClient>>, plan: AttrPlan, report: rpc.ImportReport): Promise<number> {
  if (plan.updates.length === 0) return 0;
  const all = (await fetchAllRows(() => sb.from("products").select("id, sku, name").order("created_at").order("id"))) as { id: string; sku: string | null; name: string }[];
  const bySku = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of all) {
    if (p.sku && !bySku.has(p.sku)) bySku.set(p.sku, p.id);
    const k = p.name.trim().toLowerCase();
    if (k && !byName.has(k)) byName.set(k, p.id);
  }
  let set = 0;
  const CHUNK = 20;
  for (let i = 0; i < plan.updates.length; i += CHUNK) {
    const batch = plan.updates.slice(i, i + CHUNK);
    const results = await Promise.all(
      batch.map(async (u) => {
        const id = resolveImportedRow(u, bySku, byName);
        if (!id) return false; // a row import_products skipped
        const { error } = await sb.from("products").update(u.columns).eq("id", id);
        if (error) report.errors.push({ sku: u.sku || undefined, name: u.name || undefined, error: `brand/size not saved: ${error.message}` });
        return !error;
      }),
    );
    set += results.filter(Boolean).length;
  }
  return set;
}
