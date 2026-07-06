"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const schema = z.object({
  id: z.string(),
  name: z.string().min(1),
  terms: z.array(z.string()),
  customFields: z.array(z.object({ label: z.string(), value: z.string() })),
  showBankDetails: z.boolean(),
  showTerms: z.boolean(),
  showSignature: z.boolean(),
  headerBannerPath: z.string().nullable(),
  footerBannerPath: z.string().nullable(),
  logoPath: z.string().nullable(),
});

export type TemplateResult = { ok: true } | { ok: false; error: string };

export async function updateTemplateAction(input: z.infer<typeof schema>): Promise<TemplateResult> {
  await requireRole("owner", "manager");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid template" };
  const d = parsed.data;

  const config = {
    header_banner_path: d.headerBannerPath || null,
    footer_banner_path: d.footerBannerPath || null,
    logo_path: d.logoPath || null,
    show_bank_details: d.showBankDetails,
    show_terms: d.showTerms,
    show_signature: d.showSignature,
    terms: d.terms.map((t) => t.trim()).filter((t) => t.length > 0),
    custom_fields: d.customFields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
      .filter((f) => f.label.length > 0),
  };

  const sb = await createClient();
  const { error } = await sb
    .from("document_templates")
    .update({ name: d.name, config, is_default: true })
    .eq("id", d.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/templates");
  return { ok: true };
}
