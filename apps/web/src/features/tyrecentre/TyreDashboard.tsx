import Link from "next/link";
import { MapPin, Package, Users, Wrench } from "lucide-react";
import { getDashboard } from "@/lib/supabase/queries/dashboard";
import { getTyreDashboardSeries } from "@/lib/supabase/queries/tyrecentre-dashboard";
import { getSessionContext } from "@/lib/auth/session";
import { formatMUR } from "@/lib/money";
import { muDayLabel } from "@/lib/mu-date";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { TcBadge, type TcBadgeTone } from "@/components/tyrecentre/TcBadge";
import { DashboardStats, MethodsDonut, SalesAreaChart } from "./DashboardCharts";

const STATUS_TONE: Record<string, TcBadgeTone> = {
  paid: "attention",
  accepted: "attention",
  issued: "outline",
  partly_paid: "outline",
  void: "danger",
  declined: "danger",
};

/** The tyre-centre /dashboard: Carfectionist's sections and figures, built from Easy UI's
 *  stat cards, interactive area chart and donut chart in the tyre-centre colours. */
export async function TyreDashboard() {
  const [d, series, session] = await Promise.all([getDashboard({}), getTyreDashboardSeries(), getSessionContext()]);
  const name = (session?.displayName ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  const bestMax = d.bestServices[0]?.cents ?? 1;

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.6px] text-tc-ink sm:text-[30px]">
          Welcome back{name ? `, ${name}` : ""}
        </h1>
        <div className="mt-1 font-mono text-[12px] text-tc-muted">{muDayLabel(new Date().toISOString())}</div>
      </div>

      <DashboardStats series={series} outstandingCents={d.outstandingCents} />

      <SalesAreaChart series={series} />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,420px)_1fr]">
        <TcCard className="p-5" aria-labelledby="tc-methods">
          <h2 id="tc-methods" className="text-[15px] font-bold text-tc-ink">
            Collected by method
          </h2>
          <div className="mb-3 mt-0.5 text-[12.5px] text-tc-muted">All recorded payments</div>
          <MethodsDonut byMethod={d.byMethod} />
        </TcCard>

        <TcCard className="p-5" aria-labelledby="tc-catalogue">
          <h2 id="tc-catalogue" className="text-[15px] font-bold text-tc-ink">
            Catalogue &amp; team
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-2.5 text-[13.5px]">
            {[
              { icon: Wrench, label: "Services", value: d.counts.services },
              { icon: Package, label: "Stocked products", value: d.counts.stocked },
              { icon: MapPin, label: "Locations", value: d.counts.locations },
              { icon: Users, label: "Team", value: d.counts.team },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2.5 rounded-[14px] bg-tc-sub px-3.5 py-3">
                <r.icon className="size-4 text-tc-primary" />
                <span className="flex-1 text-tc-muted">{r.label}</span>
                <span className="font-mono font-semibold tabular-nums text-tc-ink">{r.value}</span>
              </div>
            ))}
          </div>
        </TcCard>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <TcCard className="p-5" aria-labelledby="tc-recent">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="tc-recent" className="text-[15px] font-bold text-tc-ink">
              Recent documents
            </h2>
            <Link href="/sales" className="text-[13px] text-tc-muted hover:text-tc-ink">
              View all →
            </Link>
          </div>
          {d.recent.length === 0 ? (
            <div className="py-8 text-center text-[13.5px] text-tc-faint">No documents yet.</div>
          ) : (
            <ul className="flex flex-col">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/sales/${r.id}`} className="flex items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-tc-sub">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-tc-ink">{r.customer ?? "—"}</div>
                      <div className="font-mono text-[11px] text-tc-faint">
                        {r.number ?? "Draft"} · {r.date}
                      </div>
                    </div>
                    <span className="font-mono text-[12.5px] font-semibold tabular-nums text-tc-ink">{formatMUR(r.totalCents)}</span>
                    <TcBadge tone={STATUS_TONE[r.status] ?? "neutral"} className="capitalize">
                      {r.status.replace(/_/g, " ")}
                    </TcBadge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TcCard>

        <TcCard className="p-5" aria-labelledby="tc-best">
          <h2 id="tc-best" className="mb-4 text-[15px] font-bold text-tc-ink">
            Best-selling services
          </h2>
          {d.bestServices.length === 0 ? (
            <div className="py-8 text-center text-[13.5px] text-tc-faint">Sales analytics activate as invoices are paid.</div>
          ) : (
            <ol className="flex flex-col gap-3.5">
              {d.bestServices.map((s, i) => (
                <li key={s.name} className="flex items-center gap-3">
                  <span className="w-5 font-mono text-[13px] font-bold text-tc-faint">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-tc-body">{s.name}</div>
                    <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-tc-track">
                      <div className="h-full rounded-full bg-tc-primary" style={{ width: `${Math.round((s.cents / bestMax) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[12.5px] font-semibold tabular-nums text-tc-ink">{formatMUR(s.cents)}</div>
                    <div className="text-[11px] text-tc-faint">{s.qty} sold</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TcCard>
      </div>
    </div>
  );
}
