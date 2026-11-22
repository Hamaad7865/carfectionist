import { Suspense } from "react";
import { getTyreOverview } from "@/lib/supabase/queries/tyrecentre-overview";
import { muDateTime, muNow } from "@/lib/mu-date";
import { BaysCard, RefreshButton, SalesCard, TodayStrip } from "./overview/OverviewClient";
import { NeedsCard, OverviewSkeleton, TopSellersCard } from "./overview/OverviewCards";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Saturday, 21 November · 13:54" in Mauritius time. */
function nowLine(nowMs: number): string {
  const d = muNow(nowMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${hh}:${mm}`;
}

async function OverviewBody() {
  const o = await getTyreOverview();
  const month = MONTHS[muNow(o.nowMs).getUTCMonth()];
  return (
    <>
      <div className="-mt-1 font-mono text-[12px] text-tc-muted">
        {nowLine(o.nowMs)}
        {o.tillOpenedAt ? ` · till open since ${muDateTime(o.tillOpenedAt).slice(11)}` : " · till closed"}
      </div>
      <TodayStrip companies={o.companies} today={o.today} collected={o.collected} bays={o.bays} owed={o.owed} />
      <SalesCard companies={o.companies} sales={o.sales} />
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <BaysCard bays={o.bays} companies={o.companies} />
          <TopSellersCard top={o.top} month={month} />
        </div>
        <NeedsCard needs={o.needs} />
      </div>
    </>
  );
}

/** The tyre-centre Overview (phase F): today per company, sales by company, the bays, top sellers
 *  and what needs the owner. Built to the "Dashboard (phase F)" frame in the Kite mock-up. */
export function TyreDashboard() {
  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 font-display text-[28px] font-semibold leading-tight tracking-[-0.6px] text-tc-ink sm:text-[30px]">Overview</h1>
        <RefreshButton />
      </div>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewBody />
      </Suspense>
    </div>
  );
}
