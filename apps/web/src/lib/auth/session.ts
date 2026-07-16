import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasModule, type Role } from "./roles";

export interface SessionContext {
  userId: string;
  tenantId: string;
  role: Role;
  displayName: string;
  modules: string[] | null; // per-user override; null = role default
}

/**
 * Who is this request? — in ONE round trip.
 *
 * This used to make two, back to back: auth.getUser() (a network call asking
 * Supabase Auth to validate the token) and then a select on app_users for the
 * tenant and role. From the Worker each hop costs ~250ms, so every page in the
 * app paid ~500ms before it could begin — the single biggest fixed cost we had.
 *
 * The current_app_user() RPC answers both at once, and the security is the same:
 * PostgREST verifies the JWT's signature before the function runs, so auth.uid()
 * is null for a forged or expired token and the function returns nothing. The
 * function is pinned to auth.uid(), so it can only ever return the caller's own
 * row, and only while their account is active.
 *
 * Dropping getUser() does NOT affect token refresh — that runs in the browser
 * (AuthKeepalive), because Workers can't run Next's Node-only middleware.
 *
 * Still cached per request, so the layout and the page share the one lookup.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("current_app_user");
  if (error) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (!row?.user_id) return null;

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    role: row.role as Role,
    displayName: row.display_name,
    modules: Array.isArray(row.modules) ? row.modules : null,
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
