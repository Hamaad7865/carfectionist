"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

const opt = z.string().trim().optional().transform((v) => (v ? v : null));

const schema = z.object({
  legalName: z.string().trim().min(1, "Legal name is required"),
  tradingName: opt,
  brn: opt,
  vatNumber: opt,
  email: opt,
  phone: opt,
  address: opt,
  bankAccountName: opt,
  bankAccountNumber: opt,
  bankName: opt,
  vatRate: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : 15;
  }),
  // The whole programme's off switch (20260811000090). Separate from the rates: a rate of
  // zero stops the earning but leaves every balance already given out spendable, which is
  // not the same as "we don't do points".
  pointsEnabled: z.boolean(),
  // Mirrors business_settings' own CHECK constraints (20260811000020): earning may be
  // switched off at zero, but never negative; a point must always be worth something,
  // or spend_points has nothing to divide by.
  pointsPer100: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  }),
  pointValueRupees: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }),
});

export async function saveBusinessProfileAction(input: z.input<typeof schema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid details" };
  const sb = await createClient();
  const { error } = await sb
    .from("business_settings")
    .update({
      legal_name: p.data.legalName,
      trading_name: p.data.tradingName,
      brn: p.data.brn,
      vat_number: p.data.vatNumber,
      email: p.data.email,
      phone: p.data.phone,
      address: p.data.address,
      bank_account_name: p.data.bankAccountName,
      bank_account_number: p.data.bankAccountNumber,
      bank_name: p.data.bankName,
      vat_rate: p.data.vatRate,
      points_enabled: p.data.pointsEnabled,
      points_per_100: p.data.pointsPer100,
      point_value_rupees: p.data.pointValueRupees,
    })
    .eq("id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * The logo printed at the top of every till receipt (thermal + on-screen +
 * the web ticket) — Cashmag prints one, so do we. Stores the brand-assets
 * OBJECT PATH; every renderer signs it fresh (the bucket is private).
 */
export async function setReceiptLogoAction(path: string): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = z.string().trim().max(300).safeParse(path);
  if (!p.success) return { ok: false, error: "Invalid image path" };
  // "" clears. Anything else must be this tenant's own object — the bucket's
  // RLS enforced that on upload; never store a path we would refuse to sign.
  if (p.data && !p.data.startsWith(`${ctx.tenantId}/`)) {
    return { ok: false, error: "That image does not belong to this business" };
  }
  const sb = await createClient();
  const { error } = await sb
    .from("business_settings")
    .update({ receipt_logo_path: p.data || null })
    .eq("id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/templates");
  return { ok: true };
}
