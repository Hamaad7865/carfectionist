"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import * as rpc from "@/lib/supabase/rpc";

const ROLES = ["owner", "manager"] as const;
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function createSupplierAction(name: string): Promise<Result<{ id: string; name: string }>> {
  const ctx = await requireRole(...ROLES);
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Supplier name is required." };
  const sb = await createClient();
  const { data, error } = await sb.from("suppliers").insert({ tenant_id: ctx.tenantId, name: clean }).select("id, name").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/purchases");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, data: { id: (data as any).id, name: (data as any).name } };
}

const createSchema = z.object({
  supplierId: z.string().min(1),
  reference: z.string().optional(),
  orderDate: z.string().optional(),
  lines: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive(), unitCost: z.number().nonnegative() })).min(1),
});

export async function createPurchaseOrderAction(input: z.infer<typeof createSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a supplier and at least one line." };
  const sb = await createClient();

  const { data: po, error: e1 } = await sb
    .from("purchase_orders")
    .insert({
      tenant_id: ctx.tenantId,
      supplier_id: p.data.supplierId,
      reference: p.data.reference || null,
      order_date: p.data.orderDate || null,
      status: "ordered",
    })
    .select("id")
    .single();
  if (e1) return { ok: false, error: e1.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poId = (po as any).id as string;
  const { error: e2 } = await sb.from("purchase_order_lines").insert(
    p.data.lines.map((l) => ({
      tenant_id: ctx.tenantId,
      purchase_order_id: poId,
      product_id: l.productId,
      qty_ordered: l.qty,
      unit_cost: l.unitCost,
    })),
  );
  if (e2) {
    await sb.from("purchase_orders").delete().eq("id", poId);
    return { ok: false, error: e2.message };
  }
  revalidatePath("/purchases");
  return { ok: true };
}

const receiveSchema = z.object({
  id: z.string(),
  locationId: z.string().nullable().optional(),
  lines: z.array(z.object({ lineId: z.string(), qty: z.number().nonnegative() })),
});

export async function receivePurchaseOrderAction(input: z.infer<typeof receiveSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = receiveSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid received quantities." };
  const sb = await createClient();
  try {
    await rpc.receivePurchaseOrder(
      sb,
      p.data.id,
      p.data.locationId ?? null,
      p.data.lines.filter((l) => l.qty > 0).map((l) => ({ line_id: l.lineId, qty: l.qty })),
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/purchases");
  revalidatePath("/products");
  return { ok: true };
}
