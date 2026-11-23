import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "@/lib/supabase/fake-admin";

const { TYRE_TENANT, CARFECTIONIST, state } = vi.hoisted(() => {
  const carfectionist = "11111111-1111-4111-8111-000000000001";
  return {
    TYRE_TENANT: "1f060b86-ad63-4dc7-93fb-a1fdfae18b27",
    CARFECTIONIST: carfectionist,
    state: { tenantId: carfectionist },
  };
});
let db: unknown;

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => db) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => ({
    userId: "aaaaaaaa-0000-4000-8000-000000000001",
    tenantId: state.tenantId,
    role: "owner",
    displayName: "Owner",
    modules: null,
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { savePosRulesAction } from "./pos-rules-actions";
import { saveProductAction } from "@/features/products/actions";

const input = {
  carwashPct: "25",
  defaultPolicyService: "none" as const,
  defaultPolicyGoods: "free" as const,
  defaultOpeningFloat: "1500",
  allowNegativeStock: false,
  reversalRequiresOwner: true,
};

beforeEach(() => {
  state.tenantId = TYRE_TENANT;
});

describe("tyre-centre POS rules", () => {
  it("never writes the hidden carwash cap for a tyre tenant", async () => {
    const tables = {
      business_settings: [{
        id: TYRE_TENANT,
        discount_carwash_pct: 5,
        default_policy_service: "none",
        default_policy_goods: "free",
        default_opening_float: 0,
        allow_negative_stock: true,
        reversal_requires_owner: false,
      }],
    };
    db = fakeAdmin(tables);

    const result = await savePosRulesAction(input);

    expect(result.ok).toBe(true);
    expect(tables.business_settings[0]).toMatchObject({
      discount_carwash_pct: 5,
      default_opening_float: 1500,
      allow_negative_stock: false,
      reversal_requires_owner: true,
    });
  });

  it("rejects a carwash policy submitted directly to a tyre tenant", async () => {
    const tables = {
      business_settings: [{
        id: TYRE_TENANT,
        discount_carwash_pct: 5,
        default_policy_service: "none",
        default_policy_goods: "free",
      }],
    };
    db = fakeAdmin(tables);

    const result = await savePosRulesAction({ ...input, defaultPolicyGoods: "carwash" });

    expect(result).toEqual({
      ok: false,
      error: "Carwash discount rules are not available for a tyre centre.",
    });
    expect(tables.business_settings[0].default_policy_goods).toBe("free");
  });

  it("keeps the carwash settings available to Carfectionist", async () => {
    state.tenantId = CARFECTIONIST;
    const tables = {
      business_settings: [{
        id: CARFECTIONIST,
        discount_carwash_pct: 5,
        default_policy_service: "none",
        default_policy_goods: "free",
        default_opening_float: 0,
        allow_negative_stock: true,
        reversal_requires_owner: false,
      }],
    };
    db = fakeAdmin(tables);

    const result = await savePosRulesAction({ ...input, defaultPolicyGoods: "carwash" });

    expect(result.ok).toBe(true);
    expect(tables.business_settings[0]).toMatchObject({
      discount_carwash_pct: 25,
      default_policy_goods: "carwash",
    });
  });

  it("also rejects a carwash product rule for a tyre tenant", async () => {
    const result = await saveProductAction({
      name: "Test tyre",
      kind: "product",
      category: "Tyres",
      unit: "piece",
      discountPolicy: "carwash",
      sellingPrice: "1000",
      costPrice: "0",
    });

    expect(result).toEqual({
      ok: false,
      error: "Carwash discount rules are not available for a tyre centre.",
    });
  });
});
