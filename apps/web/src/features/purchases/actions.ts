"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const schema = z.object({
  category: z.string().min(1),
  description: z.string().optional(),
  amountCents: z.number().int().nonnegative(),
  vatCents: z.number().int().nonnegative(),
  status: z.enum(["paid", "due"]),
  expenseDate: z.string().min(1),
});

export type ExpenseResult = { ok: true } | { ok: false; error: string };

export async function addExpenseAction(input: z.infer<typeof schema>): Promise<ExpenseResult> {
  const ctx = await requireRole("owner", "manager", "accountant");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid expense" };
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.from("expenses").insert({
    tenant_id: ctx.tenantId,
    category: d.category,
    description: d.description || null,
    amount: d.amountCents / 100,
    vat_amount: d.vatCents / 100,
    status: d.status,
    expense_date: d.expenseDate,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/purchases");
  return { ok: true };
}
