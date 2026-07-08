import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getIntakeData } from "@/lib/supabase/queries/intake";
import { IntakeFlow } from "@/features/intake/IntakeFlow";

export default async function IntakePage() {
  const { tenantId, customers } = await getIntakeData();

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/jobs" className="flex size-9 items-center justify-center rounded-[10px] border border-line-2 bg-card text-muted hover:text-body">
          <ArrowLeft size={17} />
        </Link>
        <div>
          <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Reception · Intake</h2>
          <p className="text-[12.5px] text-muted">Customer → vehicle → condition → quotation</p>
        </div>
      </div>
      <IntakeFlow tenantId={tenantId} customers={customers} />
    </div>
  );
}
