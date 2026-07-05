"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { existsInTenant } from "@/lib/supabase/guards";

const ROLES = ["owner", "manager", "cashier"] as const;
type Result = { ok: true } | { ok: false; error: string };

const createSchema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  kind: z.string().trim().min(1, "Describe the reminder"),
  dueDate: z.string().min(1, "Pick a due date"),
  notes: z.string().trim().optional(),
});

export async function createReminderAction(input: z.input<typeof createSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid reminder" };
  const sb = await createClient();
  if (!(await existsInTenant(sb, "customers", p.data.customerId))) return { ok: false, error: "Unknown customer." };
  if (!(await existsInTenant(sb, "vehicles", p.data.vehicleId))) return { ok: false, error: "Unknown vehicle." };
  const { error } = await sb.from("maintenance_reminders").insert({
    tenant_id: ctx.tenantId,
    customer_id: p.data.customerId,
    vehicle_id: p.data.vehicleId,
    kind: p.data.kind,
    due_date: p.data.dueDate,
    notes: p.data.notes || null,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/certificates");
  return { ok: true };
}

const STATUSES = ["pending", "sent", "done", "dismissed"] as const;
export async function setReminderStatusAction(id: string, status: (typeof STATUSES)[number]): Promise<Result> {
  await requireRole(...ROLES);
  if (!STATUSES.includes(status)) return { ok: false, error: "Invalid status" };
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { status };
  if (status === "sent") patch.sent_at = new Date().toISOString();
  const { error } = await sb.from("maintenance_reminders").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/certificates");
  return { ok: true };
}
