import { notFound } from "next/navigation";
import { getZReportProps } from "@/lib/supabase/queries/render";
import { ZReportA4 } from "@/components/pdf/ZReportA4";
import { StatementToolbar } from "../../statement/[customerId]/StatementToolbar";

// Instant Z view — the same move the statement made. "PDF" on the Z reports list
// pointed at the Browser-Rendering endpoint, which cold-starts a headless Chromium
// on every click: seconds of blank tab for a slip that is one row of frozen totals.
// Cashmag showed its Z at once, and so does this — the same ZReportA4, server-rendered
// as plain HTML, with Print / Save as PDF in the browser for whoever wants the file.
// The Email path still attaches the real Browser-Rendering PDF. RLS scopes the read
// to the tenant via the session cookie.
export default async function PrintZReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const props = await getZReportProps(id);
  if (!props) notFound();

  return (
    <div className="print-screen" style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px" }}>
      <style>{`@media print { .print-screen { background:#fff !important; padding:0 !important; } .print-toolbar { display:none !important; } }`}</style>
      <StatementToolbar />
      <div style={{ background: "#fff", maxWidth: "210mm", margin: "0 auto" }}>
        <ZReportA4 {...props} />
      </div>
    </div>
  );
}
