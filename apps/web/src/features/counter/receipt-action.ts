"use server";

import { requireRole } from "@/lib/auth/session";
import { getReceipt, type ReceiptData } from "@/lib/supabase/queries/receipt";

const ROLES = ["owner", "manager", "cashier"] as const;

/** Fetch the authoritative receipt for the just-issued invoice so the counter
 *  "Sale complete" panel shows exactly what prints (no client/server drift). */
export async function getReceiptDataAction(id: string): Promise<ReceiptData | null> {
  await requireRole(...ROLES);
  return getReceipt(id);
}
