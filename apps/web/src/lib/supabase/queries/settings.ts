import { createClient } from "@/lib/supabase/server";

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
