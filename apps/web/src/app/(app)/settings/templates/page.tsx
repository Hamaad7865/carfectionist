import Link from "next/link";
import { getDefaultTemplate } from "@/lib/supabase/queries/templates";
import { TemplateEditor } from "@/features/settings/TemplateEditor";
import { SettingsNav } from "@/features/settings/SettingsNav";

export default async function TemplatesSettingsPage() {
  const template = await getDefaultTemplate();

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="templates" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Document template</h2>
        <p className="mt-1 text-[13px] text-muted">The Diamondbrite template — the default for both quotes and invoices.</p>

        <div className="mt-6">
          {template ? (
            <TemplateEditor template={template} />
          ) : (
            <p className="text-sm text-muted">
              No default template found. Reseed the database (<Link href="/dashboard" className="text-link">dashboard</Link>).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
