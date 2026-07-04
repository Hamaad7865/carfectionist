import { Users } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function ContactsPage() {
  return (
    <PagePlaceholder
      icon={Users}
      title="Contacts"
      phase="Phase 2"
      description="Customers and their vehicles, plus suppliers. Customer detail brings together vehicles and full document history. Five customers with Mauritian-plated vehicles are already seeded."
    />
  );
}
