"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import * as rpc from "@/lib/supabase/rpc";

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
    const report = await rpc.importProducts(sb, rows, dryRun);
    if (!dryRun) revalidatePath("/products");
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
