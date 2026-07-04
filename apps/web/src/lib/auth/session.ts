import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "./roles";

export interface SessionContext {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  displayName: string;
}

/**
 * Resolve the current user + their app_users row (tenant, role). Cached per
 * request so the shell layout and page code share one lookup.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: appUser } = await supabase
    .from("app_users")
    .select("tenant_id, role, display_name")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .single();
  if (!appUser) return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    tenantId: appUser.tenant_id,
    role: appUser.role as Role,
    displayName: appUser.display_name,
  };
});

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Redirect to the dashboard if the current role is not permitted. */
export async function requireRole(...roles: Role[]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.role)) redirect("/dashboard");
  return ctx;
}
