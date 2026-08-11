"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const ROLES = ["owner", "manager"] as const;

const policy = z.enum(["none", "carwash", "free"]);

// Every field mirrors a business_settings CHECK constraint (20260812000010): the cap
// is a percent in [0,100], the defaults are one of the three policies, the float is
// non-negative. Bad input snaps to the shipped default rather than throwing.
const schema = z.object({
  carwashPct: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 5;
  }),
  defaultPolicyService: policy,
  defaultPolicyGoods: policy,
  defaultOpeningFloat: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }),
  allowNegativeStock: z.boolean(),
  reversalRequiresOwner: z.boolean(),
});

// The action echoes back the PERSISTED (post-snap) values so the form can show what
// was actually saved — a "150" cap that snapped to 5 must not sit next to a "Saved"
// badge still reading 150.
export type SavedPosRules = z.infer<typeof schema>;
type Result = { ok: true; saved: SavedPosRules } | { ok: false; error: string };

export async function savePosRulesAction(input: z.input<typeof schema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid POS rules" };
  const sb = await createClient();
  const { error } = await sb
    .from("business_settings")
    .update({
      discount_carwash_pct: p.data.carwashPct,
      default_policy_service: p.data.defaultPolicyService,
      default_policy_goods: p.data.defaultPolicyGoods,
      default_opening_float: p.data.defaultOpeningFloat,
      allow_negative_stock: p.data.allowNegativeStock,
      reversal_requires_owner: p.data.reversalRequiresOwner,
    })
    .eq("id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  // The builder reads the cap + defaults from these; the sales pages clamp on them.
  revalidatePath("/settings/pos-rules");
  revalidatePath("/sales");
  return { ok: true, saved: p.data };
}
