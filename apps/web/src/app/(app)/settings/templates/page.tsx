import Link from "next/link";
import { getDefaultTemplate } from "@/lib/supabase/queries/templates";
import { TemplateEditor } from "@/features/settings/TemplateEditor";

export default async function TemplatesSettingsPage() {
  const template = await getDefaultTemplate();

  return (
    <div className="p-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] uppercase tracking-[0.15em] text-graphite-500">Settings</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-graphite-100">Document template</h2>
        <p className="mt-1.5 text-sm text-graphite-400">
          The Diamondbrite template — the default for both quotes and invoices.
        </p>

        <div className="mt-8">
          {template ? (
            <TemplateEditor template={template} />
          ) : (
            <p className="text-sm text-graphite-500">
              No default template found. Reseed the database (<Link href="/dashboard" className="text-teal">dashboard</Link>).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
