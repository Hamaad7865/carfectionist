import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The real shop behind this deployment's public doors — the enquiry form and the
 * WhatsApp number (one WHATSAPP_PHONE_NUMBER_ID per deployment, not per tenant).
 * Service-role callers only: under RLS a user already sees just their own tenant.
 *
 * Never "the first business_settings row": with no ORDER BY that is heap order,
 * and every UPDATE to a settings row can move it. Between August and October it
 * flipped back and forth and filed 15 customer WhatsApp replies under the TEST
 * Sandbox. The sandbox is excluded by flag; the oldest real shop wins.
 *
 * A second real shop on this database makes this ambiguous again — at that point
 * route WhatsApp by the payload's metadata.phone_number_id stored per tenant.
 */
export async function liveTenantId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
): Promise<string | null> {
  const { data } = await admin
    .from("business_settings")
    .select("id")
    .eq("is_sandbox", false)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}
