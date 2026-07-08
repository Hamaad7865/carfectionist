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
  quoteSeries: string;
  invoiceSeries: string;
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
    quoteSeries: `${d.quote_prefix}… · next ${d.quote_next_number}`,
    invoiceSeries: `${d.invoice_prefix}… · next ${d.invoice_next_number}`,
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
}

export async function getTeam(): Promise<TeamMember[]> {
  const sb = await createClient();
  const session = await getSessionContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: users } = await (sb.from("app_users") as any).select("id, auth_user_id, role, display_name, is_active, pin_hash").order("display_name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (users ?? []) as any[];

  // Emails live in auth.users — look them up (service role) only for this tenant's members.
  const emailById = new Map<string, string>();
  try {
    const admin = createAdminClient();
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
  }));
}
