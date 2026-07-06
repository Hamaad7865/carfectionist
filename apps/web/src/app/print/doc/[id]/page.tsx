import { notFound } from "next/navigation";
import { getDocumentProps } from "@/lib/supabase/queries/render";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { PrintToolbar } from "./PrintToolbar";

// Standalone print view (outside the app shell). Opening it pops the browser's
// native print dialog (Windows print / Save as PDF). RLS scopes the query to
// the tenant via the session cookie.
export default async function PrintDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const props = await getDocumentProps(id);
  if (!props) notFound();

  return (
    <div className="print-screen" style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px" }}>
      <style>{`@media print { .print-screen { background:#fff !important; padding:0 !important; } .print-toolbar { display:none !important; } }`}</style>
      <PrintToolbar />
      <DocumentA4 {...props} />
    </div>
  );
}
