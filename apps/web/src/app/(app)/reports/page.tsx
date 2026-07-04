import { BarChart3 } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function ReportsPage() {
  return (
    <PagePlaceholder
      icon={BarChart3}
      title="Accounting & Reports"
      phase="Phase 3 — owner's priority"
      description="Collected-by-method, end-of-day cash-up, aged receivables, VAT report, simple P&L, per-customer statements, best-sellers and revenue by technician — every report filterable by date, method, customer, category and status, with CSV + PDF export."
    />
  );
}
