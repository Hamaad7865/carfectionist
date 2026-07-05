"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import * as rpc from "@/lib/supabase/rpc";

const ROLES = ["owner", "manager", "cashier"] as const;
type Result = { ok: true } | { ok: false; error: string };

const openSchema = z.object({ openingFloatCents: z.number().int().nonnegative() });
export async function openTillAction(input: z.infer<typeof openSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = openSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid float" };
  const sb = await createClient();
  try {
    await rpc.openCashSession(sb, "back-office", p.data.openingFloatCents / 100);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/reports");
  return { ok: true };
}

const closeSchema = z.object({ id: z.string(), countedCents: z.number().int().nonnegative() });
export async function closeTillAction(input: z.infer<typeof closeSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const p = closeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid count" };
  const sb = await createClient();
  try {
    await rpc.closeCashSession(sb, p.data.id, p.data.countedCents / 100);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/reports");
  return { ok: true };
}
