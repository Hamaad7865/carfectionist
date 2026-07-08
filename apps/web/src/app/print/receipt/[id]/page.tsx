import { notFound } from "next/navigation";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { ReceiptThermal } from "@/components/pdf/ReceiptThermal";
import { ReceiptToolbar } from "./ReceiptToolbar";

// Standalone 80mm receipt view (outside the app shell). Viewable on screen;
// Print sends it to the thermal POS printer via the browser dialog. RLS scopes
// the query to the tenant via the session cookie.
export default async function PrintReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();

  return (
    <div className="print-screen" style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px" }}>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          .print-screen { background:#fff !important; padding:0 !important; }
          .print-toolbar { display:none !important; }
          .receipt-paper { box-shadow:none !important; }
        }
      `}</style>
      <ReceiptToolbar />
      <div className="receipt-paper" style={{ width: 280, margin: "0 auto", boxShadow: "0 6px 24px rgba(15,23,32,0.14)" }}>
        <ReceiptThermal r={r} />
      </div>
    </div>
  );
}
