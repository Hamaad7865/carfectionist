import Link from "next/link";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMUR } from "@/lib/money";
import type { Seller } from "@/features/tyrecentre/overview-model";
import type { NeedItem } from "@/lib/supabase/queries/tyrecentre-overview";

function SellerList({ title, rows, empty, unit }: { title: string; rows: Seller[]; empty: string; unit: (q: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-tc-fainter">{title}</div>
      {rows.length === 0 ? (
        <div className="py-4 text-[13px] text-tc-faint">{empty}</div>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-semibold text-tc-ink">{r.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-tc-faint">{unit(r.qty)}</span>
              <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-tc-ink">{formatMUR(r.cents)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-[3px] bg-tc-track">
              <div className="h-full rounded-[3px] bg-tc-primary" style={{ width: `${Math.max(3, Math.round((r.cents / max) * 100))}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const qtyLabel = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

/** This month's best sellers: tyres by size, services by name, ranked by what they brought in. */
export function TopSellersCard({ top, month }: { top: { tyres: Seller[]; services: Seller[] } | null; month: string }) {
  return (
    <TcCard className="flex flex-col gap-4 px-5 py-[18px]" aria-labelledby="tc-top">
      <div className="flex items-center gap-2.5">
        <h2 id="tc-top" className="flex-1 text-[14px] font-bold text-tc-ink">
          Top sellers · {month}
        </h2>
        <Link href="/reports" className="text-[12.5px] text-tc-muted hover:text-tc-ink">
          Reports →
        </Link>
      </div>
      {!top ? (
        <div className="py-6 text-center text-[13.5px] text-tc-faint">Couldn&apos;t load this month&apos;s sales.</div>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
          <SellerList title="Tyre sizes" rows={top.tyres} empty="No tyres sold yet this month." unit={(q) => `×${qtyLabel(q)}`} />
          <SellerList title="Services" rows={top.services} empty="No services sold yet this month." unit={(q) => `×${qtyLabel(q)}`} />
        </div>
      )}
    </TcCard>
  );
}

/** What is waiting on the owner — the same counts as the bell and the sidebar. */
export function NeedsCard({ needs }: { needs: NeedItem[] }) {
  return (
    <TcCard className="flex flex-col gap-1 px-5 py-[18px]" aria-labelledby="tc-needs">
      <div className="flex items-center gap-2.5 pb-2">
        <h2 id="tc-needs" className="flex-1 text-[14px] font-bold text-tc-ink">
          Needs you
        </h2>
        {needs.length > 0 && (
          <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-tc-highlight px-1.5 text-[11.5px] font-bold text-tc-on-highlight">
            {needs.length}
          </span>
        )}
      </div>
      {needs.length === 0 ? (
        <div className="py-10 text-center text-[13.5px] text-tc-faint">Nothing needs you right now.</div>
      ) : (
        <ul className="flex flex-col">
          {needs.map((n, i) => (
            <li key={n.key} className={`flex flex-col gap-1.5 py-3.5 ${i > 0 ? "border-t border-tc-line" : ""}`}>
              <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-tc-fainter">
                <span className="min-w-0 flex-1 truncate">{n.kind}</span>
                {n.age && <span className="shrink-0">{n.age}</span>}
              </div>
              <div className="text-[14px] font-bold leading-snug text-tc-ink">{n.title}</div>
              <div className="text-[12.5px] leading-snug text-tc-muted">{n.reason}</div>
              <div className="pt-1">
                <Link
                  href={n.action.href}
                  className={
                    n.action.primary
                      ? "inline-flex h-8 items-center rounded-full bg-tc-primary px-3.5 text-[12.5px] font-bold text-tc-on-primary hover:opacity-95"
                      : "inline-flex h-8 items-center rounded-full bg-tc-sub px-3.5 text-[12.5px] font-semibold text-tc-ink hover:bg-tc-track"
                  }
                >
                  {n.action.label} →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </TcCard>
  );
}

/** Same shape as the page, so nothing jumps when the figures land. */
export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true" aria-label="Loading the overview">
      <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-[20px]" />
        ))}
      </div>
      <Skeleton className="h-[300px] rounded-[24px]" />
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Skeleton className="h-[320px] rounded-[24px]" />
        <Skeleton className="h-[320px] rounded-[24px]" />
      </div>
    </div>
  );
}
