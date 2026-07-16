"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import * as rpc from "@/lib/supabase/rpc";

// Managing the places stock lives. Owner and manager only — the same people who
// can already move stock between locations.
//
// Every rule lives in the RPC, not here: this layer would be trivial to bypass
// (it is just a function call), whereas the RPC is the only write path the table
// has. So these actions validate shape, then relay the database's own words —
// "Move the 40 units out of Warehouse 2 first" says more than "Could not save".

const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

const saveSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "A location needs a name").max(40, "Keep the name under 40 characters"),
  isDefault: z.boolean().nullable().optional(),
  isSalesFloor: z.boolean().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
});

/** The database raises sentences meant for a human — pass them through rather
 *  than flattening every refusal into one useless message. */
function reason(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/^ERROR:\s*/i, "").split("\n")[0].trim();
  return clean.length > 0 && clean.length < 200 ? clean : fallback;
}

function done() {
  revalidatePath("/settings/locations");
  revalidatePath("/products"); // stock columns
  revalidatePath("/dashboard"); // the low-stock bell names the floor
}

export async function saveLocationAction(input: z.infer<typeof saveSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const sb = await createClient();
  try {
    await rpc.saveStockLocation(sb, parsed.data);
  } catch (e) {
    return { ok: false, error: reason(e, "Could not save that location.") };
  }
  done();
  return { ok: true };
}

export async function deleteLocationAction(input: { id: string }): Promise<Result> {
  await requireRole(...ROLES);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown location" };
  const sb = await createClient();
  try {
    await rpc.deleteStockLocation(sb, parsed.data.id);
  } catch (e) {
    return { ok: false, error: reason(e, "Could not delete that location.") };
  }
  done();
  return { ok: true };
}
