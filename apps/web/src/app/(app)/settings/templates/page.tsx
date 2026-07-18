import Link from "next/link";
import { getDefaultTemplate } from "@/lib/supabase/queries/templates";
import { TemplateEditor } from "@/features/settings/TemplateEditor";
import { ReceiptLogoCard } from "@/features/settings/ReceiptLogoCard";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isStoredAsset, signBrandAssets } from "@/lib/pdf/assets";

export default async function TemplatesSettingsPage() {
  const sb = await createClient();
  const [session, template, bsRes] = await Promise.all([
    requireSession(),
    getDefaultTemplate(),
    sb.from("business_settings").select("receipt_logo_path").limit(1).maybeSingle(),
  ]);
  const receiptLogoPath = (bsRes.data?.receipt_logo_path as string | null) ?? "";

  // brand-assets is private, so the editor can't show uploaded artwork from the
  // stored path alone — sign it here, the same way the renderer does.
  const stored = [template?.headerBannerPath, template?.footerBannerPath, template?.logoPath, receiptLogoPath].filter(isStoredAsset);
  const signed = stored.length ? await signBrandAssets(sb, stored) : {};
  const preview = (v: string | null | undefined) => (isStoredAsset(v) ? (signed[v] ?? null) : (v || null));

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="templates" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Document template</h2>
        <p className="mt-1 text-[13px] text-muted">The Diamondbrite template — the default for both quotes and invoices.</p>

        <div className="mt-6">
          {template ? (
            <TemplateEditor
              template={template}
              tenantId={session.tenantId}
              previews={{
                header: preview(template.headerBannerPath),
                footer: preview(template.footerBannerPath),
                logo: preview(template.logoPath),
              }}
            />
          ) : (
            <p className="text-sm text-muted">
              No default template found. Reseed the database (<Link href="/dashboard" className="text-link">dashboard</Link>).
            </p>
          )}
        </div>

        <div className="mt-6">
          <ReceiptLogoCard tenantId={session.tenantId} value={receiptLogoPath} previewUrl={preview(receiptLogoPath)} />
        </div>
      </div>
    </div>
  );
}
