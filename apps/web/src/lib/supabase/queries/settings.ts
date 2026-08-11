import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionContext } from "@/lib/auth/session";

export interface BusinessProfile {
  id: string;
  legalName: string;
  tradingName: string | null;
  brn: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  vatRate: number;
  pricesVatInclusive: boolean;
  quoteSeries: string;
  invoiceSeries: string;
  /** The loyalty programme's off switch (20260811000090). Off: bills earn nothing and
   *  points cannot be spent, on the tablet or here. Balances are kept, and a reversal
   *  still refunds points taken while it was on. */
  pointsEnabled: boolean;
  /** Points earned per Rs 100 of a settled sale (customer_points_ledger, 20260811000020). */
  pointsPer100: number;
  /** What one point is worth when a customer spends it. */
  pointValueRupees: number;
}

export async function getBusinessProfile(): Promise<BusinessProfile | null> {
  const sb = await createClient();
  const { data } = await sb.from("business_settings").select("*").limit(1).maybeSingle();
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return {
    id: d.id,
    legalName: d.legal_name,
    tradingName: d.trading_name,
    brn: d.brn,
    vatNumber: d.vat_number,
    email: d.email,
    phone: d.phone,
    address: d.address,
    bankAccountName: d.bank_account_name,
    bankAccountNumber: d.bank_account_number,
    bankName: d.bank_name,
    vatRate: Number(d.vat_rate),
    pricesVatInclusive: d.prices_vat_exclusive === false,
    quoteSeries: `${d.quote_prefix}… · next ${d.quote_next_number}`,
    invoiceSeries: `${d.invoice_prefix}… · next ${d.invoice_next_number}`,
    // Absent only on a client that has not synced the column yet — a shop with points
    // running must never read as "switched off" and quietly stop earning.
    pointsEnabled: d.points_enabled !== false,
    pointsPer100: Number(d.points_per_100 ?? 1),
    pointValueRupees: Number(d.point_value_rupees ?? 1),
  };
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  email: string | null;
  active: boolean;
  isSelf: boolean;
  hasPin: boolean;
  modules: string[] | null;
}

export async function getTeam(): Promise<TeamMember[]> {
  const session = await getSessionContext();
  if (!session) return [];
  // pin_hash is client-revoked (brute-force hardening), so read the roster with
  // the service role (server-only — only a boolean leaves) scoped to this tenant.
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: users } = await (admin.from("app_users") as any)
    .select("id, auth_user_id, role, display_name, is_active, pin_hash, modules")
    .eq("tenant_id", session.tenantId)
    .order("display_name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (users ?? []) as any[];

  // Emails live in auth.users — look them up (service role) too.
  const emailById = new Map<string, string>();
  try {
    const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of authList?.users ?? []) if (u.email) emailById.set(u.id, u.email);
  } catch {
    /* emails are best-effort */
  }

  return rows.map((u) => ({
    id: u.id,
    name: u.display_name,
    role: u.role,
    email: emailById.get(u.auth_user_id) ?? null,
    active: u.is_active,
    isSelf: session?.userId === u.auth_user_id,
    hasPin: !!u.pin_hash,
    modules: Array.isArray(u.modules) ? u.modules : null,
  }));
}
