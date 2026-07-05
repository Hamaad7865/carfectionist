import { getCertificates } from "@/lib/supabase/queries/certificates";
import { CertificatesPanel } from "@/features/certificates/CertificatesPanel";

export default async function CertificatesPage() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await getCertificates(today);

  return (
    <div className="flex flex-col gap-4 p-6">
      <CertificatesPanel data={data} today={today} />
    </div>
  );
}
