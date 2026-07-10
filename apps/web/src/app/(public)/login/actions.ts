"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/supabase/audit";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Record the sign-in for the Activity log (best-effort) before leaving.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: au } = await supabase.from("app_users").select("id, tenant_id").eq("auth_user_id", user.id).maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = au as any;
      if (a) await logAudit(supabase, { tenantId: a.tenant_id, actorId: a.id, eventType: "signed_in", refType: "app_user", refId: a.id, payload: { device: "web" } });
    }
  } catch { /* ignore */ }

  redirect("/dashboard");
}
