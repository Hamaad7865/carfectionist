import { createClient } from "@/lib/supabase/server";
import type { DiscountPolicy } from "@/lib/money";

/** The owner-editable POS rules, read from the single business_settings row.
 *  Every field mirrors a column added in 20260812000010, defaulting to the value
 *  that rule was hardcoded to before it became configurable. */
export interface PosRulesSettings {
  carwashPct: number;
  defaultPolicyService: DiscountPolicy;
  defaultPolicyGoods: DiscountPolicy;
  defaultOpeningFloat: number;
  allowNegativeStock: boolean;
  reversalRequiresOwner: boolean;
}

const asPolicy = (v: unknown, fallback: DiscountPolicy): DiscountPolicy =>
  v === "none" || v === "carwash" || v === "free" ? v : fallback;

export async function getPosRules(): Promise<PosRulesSettings | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("business_settings")
    .select("discount_carwash_pct, default_policy_service, default_policy_goods, default_opening_float, allow_negative_stock, reversal_requires_owner")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return {
    carwashPct: Number(d.discount_carwash_pct ?? 5),
    defaultPolicyService: asPolicy(d.default_policy_service, "none"),
    defaultPolicyGoods: asPolicy(d.default_policy_goods, "free"),
    defaultOpeningFloat: Number(d.default_opening_float ?? 0),
    // Absent only on a client that hasn't synced the column — never read a shop that
    // allows negative-stock sales (the shipped behaviour) as forbidding them.
    allowNegativeStock: d.allow_negative_stock !== false,
    reversalRequiresOwner: d.reversal_requires_owner === true,
  };
}
