"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/supabase/audit";

// Setting the new password. By the time anyone reaches this, /auth/reset has
// already redeemed the recovery token and they hold a real session — so this is
// just "change my own password", and Supabase's updateUser authorises it against
// that session. There is no user id in the form for someone to tamper with.

export interface UpdateState {
  error?: string;
}

export async function updateMyPassword(_prev: UpdateState, formData: FormData): Promise<UpdateState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "Those two passwords don't match." };

  const sb = await createClient();
  // Re-check the session HERE rather than trusting the page that rendered the
  // form: a stale tab could post this long after the recovery session lapsed.
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) redirect("/forgot-password?expired=1");

  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    // Supabase rejects reusing the current password on some projects — say so
    // plainly rather than passing through the raw string.
    return { error: /same.*password|different from the old/i.test(error.message) ? "That's already your password — pick a new one." : error.message };
  }

  try {
    const { data: au } = await sb.from("app_users").select("id, tenant_id, display_name").eq("auth_user_id", auth.user.id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = au as any;
    if (a) {
      await logAudit(sb, {
        tenantId: a.tenant_id,
        actorId: a.id,
        eventType: "password_reset_self",
        refType: "app_user",
        refId: a.id,
        payload: { name: a.display_name ?? "" },
      });
    }
  } catch {
    /* the audit must never be the reason a password change fails */
  }

  redirect("/dashboard");
}
