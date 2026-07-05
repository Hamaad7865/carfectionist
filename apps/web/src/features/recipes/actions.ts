"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

const addSchema = z.object({
  serviceProductId: z.string().min(1),
  componentProductId: z.string().min(1),
  expectedQty: z.number().positive(),
});

export async function addRecipeComponentAction(input: z.infer<typeof addSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = addSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a component and a positive quantity." };
  if (p.data.serviceProductId === p.data.componentProductId) return { ok: false, error: "A service can't consume itself." };
  const sb = await createClient();
  const { error } = await sb.from("service_recipes").upsert(
    {
      tenant_id: ctx.tenantId,
      service_product_id: p.data.serviceProductId,
      component_product_id: p.data.componentProductId,
      expected_qty: p.data.expectedQty,
    },
    { onConflict: "tenant_id,service_product_id,component_product_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/products");
  return { ok: true };
}

export async function deleteRecipeComponentAction(id: string): Promise<Result> {
  await requireRole(...ROLES);
  const sb = await createClient();
  const { error } = await sb.from("service_recipes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/products");
  return { ok: true };
}
