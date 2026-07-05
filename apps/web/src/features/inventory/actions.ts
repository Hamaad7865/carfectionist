"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";

const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

const schema = z.object({
  productId: z.string().min(1),
  locationId: z.string().min(1),
  qty: z.number().refine((n) => n !== 0, "Quantity change can’t be zero"),
  note: z.string().trim().optional(),
});

export async function recordAdjustmentAction(input: z.input<typeof schema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid adjustment" };
  const sb = await createClient();

  // Validate the client-supplied FKs belong to the caller's tenant (RLS-scoped
  // lookups return null for a foreign-tenant id) before writing the movement.
  const { data: prod } = await sb.from("products").select("id, cost_price").eq("id", p.data.productId).maybeSingle();
  if (!prod) return { ok: false, error: "Unknown product." };
  if (!(await existsInTenant(sb, "stock_locations", p.data.locationId))) return { ok: false, error: "Unknown location." };
  // Valuation: use the product's current cost so on-hand value stays consistent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unitCost = Number((prod as any).cost_price);
  const { data: appUser } = await sb.from("app_users").select("id").eq("auth_user_id", ctx.userId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdBy = (appUser as any)?.id ?? null;

  const { error } = await sb.from("stock_movements").insert({
    tenant_id: ctx.tenantId,
    product_id: p.data.productId,
    location_id: p.data.locationId,
    qty: p.data.qty,
    unit_cost: unitCost,
    ref_type: "adjustment",
    ref_id: null,
    note: p.data.note || null,
    created_by: createdBy,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/products");
  return { ok: true };
}
