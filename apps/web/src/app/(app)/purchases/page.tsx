import { Truck } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function PurchasesPage() {
  return (
    <PagePlaceholder
      icon={Truck}
      title="Purchases & Expenses"
      phase="Phase 2 – 3"
      description="Expenses (category, amount, VAT, paid/due) and purchase orders that fire stock movements at their unit cost on receipt, feeding COGS and the VAT report."
    />
  );
}
