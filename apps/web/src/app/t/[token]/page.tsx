import { notFound } from "next/navigation";
import { verifyReceiptToken } from "@/lib/receipt-token";
import { getReceiptPublic } from "@/lib/supabase/queries/receipt";
import { ReceiptCard } from "@/components/pdf/ReceiptCard";

// PUBLIC hosted ticket — the "View my ticket" button in receipt emails.
// No session: the HMAC token IS the authorisation (unguessable without the
// server secret); a bad token is indistinguishable from a missing page.
export default async function PublicTicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const docId = await verifyReceiptToken(decodeURIComponent(token));
  if (!docId) notFound();
  const r = await getReceiptPublic(docId);
  if (!r) notFound();

  return (
    <div style={{ minHeight: "100vh", padding: "24px 16px", background: "#e9edf0" }}>
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print { body { background:#fff !important; } .t-frame { box-shadow:none !important; } }
      `}</style>
      <div className="t-frame" style={{ width: 300, margin: "0 auto", boxShadow: "0 10px 34px rgba(15,23,32,0.16)" }}>
        <ReceiptCard r={r} />
      </div>
      <p style={{ textAlign: "center", fontSize: 11, color: "#8c96a1", marginTop: 16 }}>
        {r.studioName} · Mauritius
      </p>
    </div>
  );
}
