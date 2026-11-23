"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import * as rpc from "@/lib/supabase/rpc";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { planImportedAttrs, resolveImportedRow, type AttrPlan } from "@/lib/products/import-attrs";

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
    const report = await rpc.importProducts(sb, rows, dryRun);
    report.errors = [...(report.errors ?? []), ...plan.errors];
    if (!dryRun) {
      report.attrs_set = await applyImportedAttrs(sb, plan, report);
      revalidatePath("/products");
    }
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
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
