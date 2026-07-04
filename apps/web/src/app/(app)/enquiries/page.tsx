import { Inbox } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";

export default function EnquiriesPage() {
  return (
    <PagePlaceholder
      icon={Inbox}
      title="Forms & Enquiries"
      phase="Phase 3"
      description="A minimal public enquiry form feeds this inbox; each enquiry converts into a customer and vehicle in one step."
    />
  );
}
