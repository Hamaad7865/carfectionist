import { Package } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function ProductsPage() {
  return (
    <PagePlaceholder
      icon={Package}
      title="Products & Inventory"
      phase="Phase 2"
      description="Catalogue CRUD with barcodes, on-hand per location from the event-sourced ledger, low-stock flags, the movements log, manual adjustments, and storeroom → shop-floor transfers. Ten services and sixteen consumables are already seeded."
    />
  );
}
