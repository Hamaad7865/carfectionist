import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { hasModule } from "@/lib/auth/roles";
import { getTyreOverview } from "@/lib/supabase/queries/tyrecentre-overview";
import { createClient } from "@/lib/supabase/server";
import { Overview } from "./Overview";
import { normalizeRange } from "./overview-model";

/** The tyre-centre Overview (DESIGN-SPEC §6.2), served at /dashboard for that brand. */
export async function TyreOverviewPage({ range }: { range?: string }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const can = (href: string) => hasModule(ctx.role, ctx.modules, href);
  const tillRole = ctx.role === "owner" || ctx.role === "manager";
  const sb = await createClient();
  const [data, bs] = await Promise.all([
    getTyreOverview(normalizeRange(range), { canTill: tillRole && can("/point-of-sale"), canPurchase: can("/purchases") }),
    sb.from("business_settings").select("trading_name, legal_name").limit(1).maybeSingle(),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = ((bs.data as any)?.trading_name || (bs.data as any)?.legal_name || "Overview") as string;
  return (
    <Overview
      data={data}
      shopLabel={shop}
      access={{ canSell: can("/sales"), canJournal: can("/sales-journal"), canJobs: can("/jobs") }}
    />
  );
}
