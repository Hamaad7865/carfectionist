import Link from "next/link";
import { getCertificates } from "@/lib/supabase/queries/certificates";
import { CertificatesPanel } from "@/features/certificates/CertificatesPanel";
import { getReminders } from "@/lib/supabase/queries/reminders";
import { RemindersPanel } from "@/features/reminders/RemindersPanel";

const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "reminders" ? "reminders" : "certificates";
  const today = new Date().toISOString().slice(0, 10);
  const certData = tab === "certificates" ? await getCertificates(today) : null;
  const remData = tab === "reminders" ? await getReminders(today) : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex gap-1.5">
        <Link href="/certificates" className={tabCls(tab === "certificates")}>Certificates</Link>
        <Link href="/certificates?tab=reminders" className={tabCls(tab === "reminders")}>Reminders</Link>
      </div>
      {tab === "certificates" && certData && <CertificatesPanel data={certData} today={today} />}
      {tab === "reminders" && remData && <RemindersPanel data={remData} today={today} />}
    </div>
  );
}
