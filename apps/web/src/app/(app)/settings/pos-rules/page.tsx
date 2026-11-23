import Link from "next/link";
import { getPosRules } from "@/lib/supabase/queries/pos-rules";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { PosRulesForm } from "@/features/settings/PosRulesForm";
import { getSessionContext } from "@/lib/auth/session";
import { isTyreShop } from "@/lib/auth/roles";

export default async function PosRulesPage() {
  const [rules, session] = await Promise.all([getPosRules(), getSessionContext()]);
  const tyreShop = !!session && isTyreShop(session.tenantId);

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="pos-rules" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">POS rules</h2>
        <p className="mt-1 text-[13px] text-muted">Discount limits, till defaults and reversal control — the tablet till and the sales screens read these live.</p>
        <div className="mt-6">
          {rules ? (
            <PosRulesForm rules={rules} tyreShop={tyreShop} />
          ) : (
            <p className="text-sm text-muted">
              No business settings found. Reseed the database (<Link href="/dashboard" className="text-link">dashboard</Link>).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
