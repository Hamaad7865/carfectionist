import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * True if a row with `id` is visible to the caller under RLS — i.e. it belongs
 * to the caller's tenant. Server actions accept client-supplied foreign keys
 * (customer_id, product_id, …); Postgres FK checks bypass RLS and would happily
 * accept another tenant's id, so validate ownership here before inserting.
 * Returns false for null/empty ids (caller decides if that's an error).
 */
export async function existsInTenant(
  sb: SupabaseClient<Database>,
  table: string,
  id: string | null | undefined,
): Promise<boolean> {
  if (!id) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from(table).select("id").eq("id", id).maybeSingle();
  return !!data;
}
