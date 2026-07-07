import { notFound } from "next/navigation";
import { getCertificate } from "@/lib/supabase/queries/certificates";
import { CertificateCard } from "@/features/certificates/CertificateCard";
import { PrintToolbar } from "../../doc/[id]/PrintToolbar";

// Standalone print view for a ceramic-protection certificate (outside the app
// shell). Opening it pops the browser's native print dialog. RLS scopes the
// query to the tenant via the session cookie.
export default async function PrintCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const data = await getCertificate(id, today);
  if (!data) notFound();

  return (
    <div className="print-screen" style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
      <style>{`@media print { .print-screen { background:#fff !important; padding:0 !important; } .print-toolbar { display:none !important; } }`}</style>
      <PrintToolbar />
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <CertificateCard cert={data.cert} studioName={data.studioName} showPrint={false} />
      </div>
    </div>
  );
}
