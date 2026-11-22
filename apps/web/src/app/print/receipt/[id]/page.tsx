import { notFound } from "next/navigation";
import { getReceipt } from "@/lib/supabase/queries/receipt";
import { ReceiptCard } from "@/components/pdf/ReceiptCard";
import { ReceiptToolbar } from "./ReceiptToolbar";

// Standalone receipt view (outside the app shell). Viewable on screen; Print
// sends it to the thermal POS printer via the browser dialog. RLS scopes the
// query to the tenant via the session cookie.
//
// ?also=<id>,<id> prints the other receipts of the same sale after it (tyre centre: one receipt
// per company, one Print) — one window, so no pop-up blocker eats the second receipt.
export default async function PrintReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ also?: string }> }) {
  const { id } = await params;
  const { also } = await searchParams;
  const r = await getReceipt(id);
  if (!r) notFound();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const otherIds = (also ?? "").split(",").map((x) => x.trim()).filter((x) => UUID.test(x) && x !== id).slice(0, 4);
  const others = (await Promise.all(otherIds.map((x) => getReceipt(x)))).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div className="print-screen" style={{ minHeight: "100vh", padding: "16px", background: "#e9edf0" }}>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          .print-screen { background:#fff !important; padding:0 !important; min-height:0 !important; }
          .print-toolbar { display:none !important; }
          .receipt-frame { box-shadow:none !important; }
          .receipt-next { break-before: page; margin-top:0 !important; }
          .receipt-zig { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          /* A thermal printer is 1-bit: it DITHERS every grey into sparse dots,
             so the card's muted labels came off the roll as unreadable speckle
             and the cream background as noise. On paper there is only ink or
             no ink — print pure black on pure white and keep the styling for
             screens. (If the slip still prints light, raise the darkness/heat
             setting in the printer driver.) */
          .receipt-zig { background:#fff !important; -webkit-mask:none !important; mask:none !important; }
          .receipt-zig, .receipt-zig * { color:#000 !important; border-color:#000 !important; }
          .receipt-zig svg rect { fill:#000 !important; }
        }
      `}</style>
      <ReceiptToolbar />
      <div className="receipt-frame" style={{ width: 300, margin: "0 auto", boxShadow: "0 10px 34px rgba(15,23,32,0.16)" }}>
        <ReceiptCard r={r} />
      </div>
      {others.map((o, i) => (
        <div key={i} className="receipt-frame receipt-next" style={{ width: 300, margin: "16px auto 0", boxShadow: "0 10px 34px rgba(15,23,32,0.16)" }}>
          <ReceiptCard r={o} />
        </div>
      ))}
    </div>
  );
}
