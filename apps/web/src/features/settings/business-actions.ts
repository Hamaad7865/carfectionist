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
    })
    .eq("id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}
