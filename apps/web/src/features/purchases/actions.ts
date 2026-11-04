"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { logAudit } from "@/lib/supabase/audit";

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

const updateSchema = schema.extend({ id: z.string().uuid() });

/**
 * Correct a recorded expense. This is a plain row update on purpose: expenses are
 * not fiscal documents (nothing is numbered or snapshotted), and the input-VAT /
 * P&L reports read the live row, so a correction flows straight through. The
 * tenant filter is belt-and-braces on top of the exp_update RLS policy.
 */
export async function updateExpenseAction(input: z.infer<typeof updateSchema>): Promise<ExpenseResult> {
  const ctx = await requireRole("owner", "manager", "accountant");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid expense" };
  const d = parsed.data;

  const sb = await createClient();
  const { data, error } = await sb
    .from("expenses")
    .update({
      category: d.category,
      description: d.description || null,
      amount: d.amountCents / 100,
      vat_amount: d.vatCents / 100,
      status: d.status,
      expense_date: d.expenseDate,
    })
    .eq("id", d.id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Expense not found — it may have been removed already." };

  revalidatePath("/purchases");
  return { ok: true };
}

// audit_events.actor_id references app_users(id), while the session carries the
// AUTH id — the same translation the jobs actions do.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function appUserId(sb: any, authUserId: string): Promise<string | null> {
  const { data } = await sb.from("app_users").select("id").eq("auth_user_id", authUserId).maybeSingle();
  return data?.id ?? null;
}

/**
 * Remove an expense that should never have been recorded (a duplicate, or the
 * wrong shop). Owner/manager only — matching the exp_delete RLS policy — and
 * unlike edit this is NOT recoverable, so the row is fully described into
 * audit_events first: the numbers leave the VAT/P&L reports, the record of what
 * they were and who removed it stays in the Activity feed.
 */
export async function deleteExpenseAction(id: string): Promise<ExpenseResult> {
  const ctx = await requireRole("owner", "manager");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid expense" };

  const sb = await createClient();
  const { data: row, error: readError } = await sb
    .from("expenses")
    .select("category, description, amount, vat_amount, status, expense_date")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "Expense not found — it may have been deleted already." };

  const { data: deleted, error } = await sb
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!deleted || deleted.length === 0) return { ok: false, error: "Expense not found — it may have been deleted already." };

  await logAudit(sb, {
    tenantId: ctx.tenantId,
    actorId: await appUserId(sb, ctx.userId),
    eventType: "expense.deleted",
    refType: "expense",
    refId: id,
    payload: {
      description: row.description,
      category: row.category,
      amount: row.amount,
      vat: row.vat_amount,
      status: row.status,
      date: row.expense_date,
    },
  });

  revalidatePath("/purchases");
  revalidatePath("/activity");
  return { ok: true };
}
