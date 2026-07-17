import { notFound } from "next/navigation";
import { getStatementProps } from "@/lib/supabase/queries/render";
import { StatementA4 } from "@/components/pdf/StatementA4";
import { StatementToolbar } from "./StatementToolbar";

// Instant statement view. "View" used to point at the Browser-Rendering PDF
// endpoint, which cold-starts a headless Chromium on every click — several
// seconds of blank tab for a document that has no images and a trivial query.
// This is the same StatementA4, server-rendered as plain HTML: it appears at
// once, and the owner can Save-as-PDF from the browser if they want a file. The
// Email path still attaches the real Browser-Rendering PDF. RLS scopes the
// query to the tenant via the session cookie.
export default async function PrintStatementPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const props = await getStatementProps(customerId);
  if (!props) notFound();

  return (
    <div className="print-screen" style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px" }}>
      <style>{`@media print { .print-screen { background:#fff !important; padding:0 !important; } .print-toolbar { display:none !important; } }`}</style>
      <StatementToolbar />
      <StatementA4 {...props} />
    </div>
  );
}
