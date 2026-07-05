"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import * as rpc from "@/lib/supabase/rpc";

const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

const createSchema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  note: z.string().optional(),
  lines: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive() })).min(1),
});

export async function createTransferAction(input: z.infer<typeof createSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick both locations and at least one line." };
  if (p.data.fromLocationId === p.data.toLocationId) return { ok: false, error: "From and to must differ." };
  const sb = await createClient();

  const { data: tx, error: e1 } = await sb
    .from("stock_transfers")
    .insert({
      tenant_id: ctx.tenantId,
      from_location_id: p.data.fromLocationId,
      to_location_id: p.data.toLocationId,
      note: p.data.note || null,
      status: "draft",
    })
    .select("id")
    .single();
  if (e1) return { ok: false, error: e1.message };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transferId = (tx as any).id as string;
  const { error: e2 } = await sb.from("stock_transfer_lines").insert(
    p.data.lines.map((l) => ({
      tenant_id: ctx.tenantId,
      transfer_id: transferId,
      product_id: l.productId,
      qty_dispatched: l.qty,
    })),
  );
  if (e2) {
    await sb.from("stock_transfers").delete().eq("id", transferId);
    return { ok: false, error: e2.message };
  }
  revalidatePath("/products");
  return { ok: true };
}

export async function dispatchTransferAction(id: string): Promise<Result> {
  await requireRole(...ROLES);
  const sb = await createClient();
  try {
    await rpc.dispatchTransfer(sb, id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/products");
  return { ok: true };
}

const receiveSchema = z.object({
  id: z.string(),
  lines: z.array(z.object({ lineId: z.string(), qtyReceived: z.number().nonnegative() })),
});

export async function receiveTransferAction(input: z.infer<typeof receiveSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = receiveSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid received quantities." };
  const sb = await createClient();
  try {
    await rpc.receiveTransfer(sb, p.data.id, p.data.lines.map((l) => ({ line_id: l.lineId, qty_received: l.qtyReceived })));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/products");
  return { ok: true };
}
