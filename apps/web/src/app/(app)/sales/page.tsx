import { ReceiptText } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function SalesPage() {
  return (
    <PagePlaceholder
      icon={ReceiptText}
      title="Sales & Invoices"
      phase="Phase 1 — the money path"
      description="The document builder lands here: create quotes and invoices from scratch, add catalogue and ad-hoc lines, issue with gapless numbering, convert quote → invoice, record split payments, and download a faithful Diamondbrite PDF at every step."
    />
  );
}
