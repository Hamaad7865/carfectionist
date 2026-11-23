"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { getProductMovements, type MovementRow } from "@/lib/supabase/queries/movements";

// Cashiers adjust too — but, like a manager, only with the owner's PIN for that one
// move; public.record_stock_adjustment is what enforces it.
const ROLES = ["owner", "manager", "cashier"] as const;
type Result = { ok: true } | { ok: false; error: string; needsOwner?: boolean };

const schema = z.object({
  productId: z.string().min(1),
  locationId: z.string().min(1),
  qty: z.number().refine((n) => n !== 0, "Quantity change can’t be zero"),
  // Required — this is the only record of why stock moved outside a sale/job/PO,
  // and the owner reads it straight off the ledger. Mirror the tablet's own gate.
  note: z.string().trim().min(1, "A reason is required for a manual stock adjustment."),
});

export async function recordAdjustmentAction(input: z.input<typeof schema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid adjustment" };
  const sb = await createClient();

  // The RPC checks product + location are this shop's, stamps who moved it at the
  // product's current cost, and — for anyone but the owner — consumes the owner's
  // single-use approval for exactly this move.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("record_stock_adjustment", {
    p_product_id: p.data.productId,
    p_location_id: p.data.locationId,
    p_qty: p.data.qty,
    p_note: p.data.note,
  });
  if (error) {
    const msg = String(error.message ?? "");
    if (/requires the owner/i.test(msg)) {
      return { ok: false, needsOwner: true, error: "This adjustment needs the owner's approval." };
    }
    if (/unknown product/i.test(msg)) return { ok: false, error: "Unknown product." };
    if (/unknown location/i.test(msg)) return { ok: false, error: "Unknown location." };
    return { ok: false, error: msg || "Could not record the adjustment." };
  }
  revalidatePath("/products");
  return { ok: true };
}

/** One product's full stock history, for the Inventory tab once a product is picked. */
export async function productHistoryAction(
  productId: string,
): Promise<{ ok: true; movements: MovementRow[]; truncated: boolean } | { ok: false; error: string }> {
  await requireRole(...ROLES);
  const id = z.string().uuid().safeParse(productId);
  if (!id.success) return { ok: false, error: "Unknown product." };
  try {
    return { ok: true, ...(await getProductMovements(id.data)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load this product's history." };
  }
}
