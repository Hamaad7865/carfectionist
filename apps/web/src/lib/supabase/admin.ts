import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import type { Database } from "./database.types";

/**
 * Service-role client — server-only, bypasses RLS. Used for the public enquiry
 * form (unauthenticated visitors have no session, so RLS would deny the insert).
 * NEVER import this into client code.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, // build-time inlined (NEXT_PUBLIC_*)
    serverEnv("SUPABASE_SERVICE_ROLE_KEY")!, // wrangler secret on the Worker
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
