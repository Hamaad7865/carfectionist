import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/supabase/queries/marketing";
import { CampaignProgress } from "@/features/marketing/CampaignProgress";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  return <CampaignProgress campaign={campaign} />;
}
