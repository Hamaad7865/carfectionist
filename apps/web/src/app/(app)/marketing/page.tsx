import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getMarketing, getAudience } from "@/lib/supabase/queries/marketing";
import { CampaignsPanel } from "@/features/marketing/CampaignsPanel";
import { TemplatesPanel } from "@/features/marketing/TemplatesPanel";
import { isConfigured } from "@/lib/whatsapp";

const tabCls = (on: boolean) =>
  `inline-flex h-[38px] items-center justify-center rounded-[10px] px-4 text-[13px] font-bold ${on ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body"}`;

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "templates" ? "templates" : "campaigns";
  const [data, audience] = await Promise.all([getMarketing(), tab === "campaigns" ? getAudience() : Promise.resolve([])]);
  const connected = isConfigured();

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="border-l-[3px] border-brand pl-3.5">
        <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-faint"><Megaphone size={13} /> Marketing</div>
        <h2 className="font-display text-[22px] font-extrabold text-ink-strong">WhatsApp campaigns</h2>
        <div className="mt-0.5 text-[12.5px] text-muted">Design approved message templates, then send personalised marketing to your contacts.</div>
      </div>

      {!connected && (
        <div className="rounded-[12px] border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.08)] px-4 py-3 text-[12.5px] text-amber-ink">
          <span className="font-bold">WhatsApp isn&apos;t connected yet.</span> You can design and save templates now. To submit them for approval and send campaigns, the Meta WhatsApp Cloud API credentials need to be added to this deployment.
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Link href="/marketing" className={tabCls(tab === "campaigns")}>Campaigns</Link>
        <Link href="/marketing?tab=templates" className={tabCls(tab === "templates")}>Templates</Link>
      </div>

      {tab === "campaigns" ? (
        <CampaignsPanel campaigns={data.campaigns} templates={data.templates} audience={audience} />
      ) : (
        <TemplatesPanel templates={data.templates} />
      )}
    </div>
  );
}
