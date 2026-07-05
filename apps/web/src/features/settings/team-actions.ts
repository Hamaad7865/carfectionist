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

const createSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES),
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

  const { error: rowErr } = await admin.from("app_users").insert({
    tenant_id: ctx.tenantId,
    auth_user_id: created.user.id,
    role: p.data.role,
    display_name: p.data.displayName,
    is_active: true,
  });
  if (rowErr) {
    // Roll back the orphaned auth user so a retry can reuse the email.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: rowErr.message };
  }
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
