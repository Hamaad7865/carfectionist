import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasModule, type Role } from "./roles";

export interface SessionContext {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  displayName: string;
  modules: string[] | null; // per-user override; null = role default
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("tenant_id, role, display_name, modules" as any)
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .single();
  if (!appUser) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const au = appUser as any;
  return {
    userId: user.id,
    email: user.email ?? "",
    tenantId: au.tenant_id,
    role: au.role as Role,
    displayName: au.display_name,
    modules: Array.isArray(au.modules) ? au.modules : null,
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

/** Redirect to the dashboard if the current user's module access excludes href. */
export async function requireModule(href: string): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!hasModule(ctx.role, ctx.modules, href)) redirect("/dashboard");
  return ctx;
}
