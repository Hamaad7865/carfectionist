import { notFound } from "next/navigation";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { TicketA4 } from "@/components/pdf/TicketA4";
import { ReceiptToolbar } from "../../receipt/[id]/ReceiptToolbar";

// A4 ticket detail (Cashmag print parity): full HT/TTC line table, tax block
// and payment detail. The thermal slip stays at /print/receipt/[id].
export default async function PrintTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();

  return (
    <div className="print-screen" style={{ minHeight: "100vh", padding: "16px", background: "#e9edf0" }}>
      <style>{`
        @page { size: A4; margin: 0; }
        @media print {
          .print-screen { background:#fff !important; padding:0 !important; min-height:0 !important; }
          .print-toolbar { display:none !important; }
          .ticket-frame { box-shadow:none !important; }
        }
      `}</style>
      <ReceiptToolbar />
      <div className="ticket-frame" style={{ width: 794, margin: "0 auto", boxShadow: "0 10px 34px rgba(15,23,32,0.16)" }}>
        <TicketA4 r={r} />
      </div>
    </div>
  );
}
