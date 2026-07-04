import { createClient } from "@/lib/supabase/server";

export interface TemplateData {
  id: string;
  name: string;
  terms: string[];
  showBankDetails: boolean;
  showTerms: boolean;
  showSignature: boolean;
  headerBannerPath: string | null;
  footerBannerPath: string | null;
  logoPath: string | null;
}

export async function getDefaultTemplate(): Promise<TemplateData | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("document_templates")
    .select("id, name, config")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (data as any).config ?? {};
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: (data as any).id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: (data as any).name,
    terms: Array.isArray(c.terms) ? c.terms : [],
    showBankDetails: c.show_bank_details ?? true,
    showTerms: c.show_terms ?? true,
    showSignature: c.show_signature ?? false,
    headerBannerPath: c.header_banner_path ?? null,
    footerBannerPath: c.footer_banner_path ?? null,
    logoPath: c.logo_path ?? null,
  };
}
