"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/session";

type Result = { ok: true } | { ok: false; error: string };
const ROLES = ["owner", "manager", "cashier", "technician", "accountant"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selfAppUserId(sb: any, authUserId: string): Promise<string | null> {
  const { data } = await sb.from("app_users").select("id").eq("auth_user_id", authUserId).maybeSingle();
  return data?.id ?? null;
}

const pinField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^[0-9]{4}$/.test(v), "PIN must be exactly 4 digits");

const createSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES),
  pin: pinField,
});

export async function createStaffAction(input: z.input<typeof createSchema>): Promise<Result> {
  const ctx = await requireRole("owner");
  const p = createSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid details" };

  const admin = createAdminClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: p.data.email,
    password: p.data.password,
    email_confirm: true,
  });
  if (authErr || !created?.user) {
    return { ok: false, error: /registered|exists/i.test(authErr?.message ?? "") ? "That email already has an account." : authErr?.message ?? "Could not create the user." };
  }

  const { data: row, error: rowErr } = await admin
    .from("app_users")
    .insert({
      tenant_id: ctx.tenantId,
      auth_user_id: created.user.id,
      role: p.data.role,
      display_name: p.data.displayName,
      is_active: true,
    })
    .select("id")
    .single();
  if (rowErr || !row) {
    // Roll back the orphaned auth user so a retry can reuse the email.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: rowErr?.message ?? "Could not add the team member." };
  }

  // Optional Android PIN — set via the owner's RLS session (set_staff_pin checks the owner role).
  if (p.data.pin) {
    const sb = await createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: pinErr } = await (sb as any).rpc("set_staff_pin", { p_app_user_id: (row as { id: string }).id, p_pin: p.data.pin });
    if (pinErr) return { ok: false, error: `Login created, but the PIN failed: ${pinErr.message}` };
  }

  revalidatePath("/settings/team");
  return { ok: true };
}

const pinSchema = z.object({ id: z.string().min(1), pin: z.string().trim().regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits") });
export async function setStaffPinAction(input: z.input<typeof pinSchema>): Promise<Result> {
  await requireRole("owner");
  const p = pinSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid PIN" };
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("set_staff_pin", { p_app_user_id: p.data.id, p_pin: p.data.pin });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function clearStaffPinAction(id: string): Promise<Result> {
  await requireRole("owner");
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("clear_staff_pin", { p_app_user_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true };
}

const roleSchema = z.object({ id: z.string().min(1), role: z.enum(ROLES) });
export async function setRoleAction(input: z.infer<typeof roleSchema>): Promise<Result> {
  const ctx = await requireRole("owner");
  const p = roleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid role" };
  const sb = await createClient();
  const selfId = await selfAppUserId(sb, ctx.userId);
  if (p.data.id === selfId && p.data.role !== "owner") return { ok: false, error: "You can’t remove your own owner role." };
  const { error } = await sb.from("app_users").update({ role: p.data.role }).eq("id", p.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function setActiveAction(id: string, active: boolean): Promise<Result> {
  const ctx = await requireRole("owner");
  const sb = await createClient();
  const selfId = await selfAppUserId(sb, ctx.userId);
  if (id === selfId && !active) return { ok: false, error: "You can’t deactivate your own account." };
  const { error } = await sb.from("app_users").update({ is_active: active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true };
}
