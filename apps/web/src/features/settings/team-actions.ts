"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, type SessionContext } from "@/lib/auth/session";
import { logAudit } from "@/lib/supabase/audit";

type Result = { ok: true } | { ok: false; error: string };
const ROLES = ["owner", "manager", "cashier", "technician", "accountant"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selfAppUserId(sb: any, authUserId: string): Promise<string | null> {
  const { data } = await sb.from("app_users").select("id").eq("auth_user_id", authUserId).maybeSingle();
  return data?.id ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nameOf(sb: any, id: string): Promise<string> {
  const { data } = await sb.from("app_users").select("display_name").eq("id", id).maybeSingle();
  return ((data?.display_name ?? "") as string).replace(/\s*\(.*\)\s*$/, "").trim() || "a teammate";
}

/** Record an owner admin/security action against the acting owner, for the Activity log. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function auditAdmin(sb: any, ctx: SessionContext, eventType: string, targetId: string, payload: Record<string, unknown>) {
  const actorId = await selfAppUserId(sb, ctx.userId);
  await logAudit(sb, { tenantId: ctx.tenantId, actorId, eventType, refType: "app_user", refId: targetId, payload });
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

  await auditAdmin(await createClient(), ctx, "staff_created", (row as { id: string }).id, { name: p.data.displayName, role: p.data.role, email: p.data.email });
  revalidatePath("/settings/team");
  return { ok: true };
}

const pinSchema = z.object({ id: z.string().min(1), pin: z.string().trim().regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits") });
export async function setStaffPinAction(input: z.input<typeof pinSchema>): Promise<Result> {
  const ctx = await requireRole("owner");
  const p = pinSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid PIN" };
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("set_staff_pin", { p_app_user_id: p.data.id, p_pin: p.data.pin });
  if (error) return { ok: false, error: error.message };
  await auditAdmin(sb, ctx, "staff_pin_set", p.data.id, { name: await nameOf(sb, p.data.id) });
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function clearStaffPinAction(id: string): Promise<Result> {
  const ctx = await requireRole("owner");
  const sb = await createClient();
  const name = await nameOf(sb, id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).rpc("clear_staff_pin", { p_app_user_id: id });
  if (error) return { ok: false, error: error.message };
  await auditAdmin(sb, ctx, "staff_pin_cleared", id, { name });
  revalidatePath("/settings/team");
  return { ok: true };
}

// ── Per-user module access (owner-only) ──────────────────────────────────────
const modulesSchema = z.object({ id: z.string().min(1), modules: z.array(z.string()).nullable() });
export async function setModulesAction(input: z.input<typeof modulesSchema>): Promise<Result> {
  const ctx = await requireRole("owner");
  const p = modulesSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid module selection" };
  const sb = await createClient();
  // null = reset to the role's defaults; a list = explicit allow-list of nav hrefs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).from("app_users").update({ modules: p.data.modules }).eq("id", p.data.id);
  if (error) return { ok: false, error: error.message };
  await auditAdmin(sb, ctx, "staff_modules_changed", p.data.id, { name: await nameOf(sb, p.data.id), modules: p.data.modules });
  revalidatePath("/settings/team");
  return { ok: true };
}

// ── Reset a staff member's web password (owner-only) ─────────────────────────
const pwSchema = z.object({ id: z.string().min(1), password: z.string().min(8, "Password must be at least 8 characters") });
export async function resetPasswordAction(input: z.input<typeof pwSchema>): Promise<Result> {
  const ctx = await requireRole("owner");
  const p = pwSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid password" };
  const admin = createAdminClient();
  const { data: row } = await admin.from("app_users").select("auth_user_id").eq("id", p.data.id).maybeSingle();
  const authId = (row as { auth_user_id: string } | null)?.auth_user_id;
  if (!authId) return { ok: false, error: "User not found." };
  const { error } = await admin.auth.admin.updateUserById(authId, { password: p.data.password });
  if (error) return { ok: false, error: error.message };
  const sb = await createClient();
  await auditAdmin(sb, ctx, "staff_password_reset", p.data.id, { name: await nameOf(sb, p.data.id) });
  return { ok: true };
}

// ── Delete a staff member (owner-only) ───────────────────────────────────────
export async function deleteStaffAction(id: string): Promise<Result> {
  const ctx = await requireRole("owner");
  const sb = await createClient();
  const selfId = await selfAppUserId(sb, ctx.userId);
  if (id === selfId) return { ok: false, error: "You can’t delete your own account." };
  const name = await nameOf(sb, id); // capture before the row is gone
  const admin = createAdminClient();
  const { data: row } = await admin.from("app_users").select("auth_user_id").eq("id", id).maybeSingle();
  const authId = (row as { auth_user_id: string } | null)?.auth_user_id;
  if (!authId) return { ok: false, error: "User not found." };
  // Deleting the auth user cascades to app_users, but a created_by reference
  // (sales, jobs, stock…) on the append-only ledger blocks that cascade.
  const { error } = await admin.auth.admin.deleteUser(authId);
  if (error) {
    return { ok: false, error: "This user can’t be deleted — they’ve created records (sales, jobs, etc.). Deactivate them instead." };
  }
  await auditAdmin(sb, ctx, "staff_deleted", id, { name });
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
  await auditAdmin(sb, ctx, "staff_role_changed", p.data.id, { name: await nameOf(sb, p.data.id), role: p.data.role });
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
  await auditAdmin(sb, ctx, active ? "staff_activated" : "staff_deactivated", id, { name: await nameOf(sb, id) });
  revalidatePath("/settings/team");
  return { ok: true };
}
