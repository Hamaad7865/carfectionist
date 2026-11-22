import { getSessionContext } from "@/lib/auth/session";
import { getCompaniesAdmin } from "@/lib/supabase/queries/companies";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { CompaniesPanel } from "@/features/settings/CompaniesPanel";

export default async function CompaniesSettingsPage() {
  const [session, companies] = await Promise.all([getSessionContext(), getCompaniesAdmin()]);
  // Everyone may look; only the owner may add or change a company (save_legal_entity enforces it).
  const canManage = session?.role === "owner";

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="companies" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Companies</h2>
        <p className="mt-1 text-[13px] text-muted">
          The companies this shop bills under. Each one prints its own name, BRN and VAT status on its receipts and
          invoices, and keeps its own numbers. A sale with items from two companies gives the customer two invoices
          and one payment.
        </p>
        <div className="mt-6">
          <CompaniesPanel companies={companies} canManage={canManage} />
        </div>
      </div>
    </div>
  );
}
