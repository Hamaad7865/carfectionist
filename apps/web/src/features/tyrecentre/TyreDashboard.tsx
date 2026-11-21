import Link from "next/link";
import { Banknote, Clock, FileText, MapPin, Package, Plus, ReceiptText, Users, Wrench } from "lucide-react";
import { getDashboard } from "@/lib/supabase/queries/dashboard";
import { getSessionContext } from "@/lib/auth/session";
import { hasModule } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMUR } from "@/lib/money";
import { muDayLabel } from "@/lib/mu-date";
import { SalesPerformanceChart } from "@/features/dashboard/SalesPerformanceChart";
import { normalizeSalesPeriodInput, type SalesSearchParams } from "@/features/dashboard/sales-performance";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { TcBadge, type TcBadgeTone } from "@/components/tyrecentre/TcBadge";
import { TC_MICRO } from "@/components/tyrecentre/tc";

// The tyre-centre palette (DESIGN-SPEC §2) in place of Carfectionist's blues and purples.
const METHOD_COLOR: Record<string, string> = {
  cash: "#0DA77C",
  card: "#0F1720",
  juice: "#2B8CFF",
  bank_transfer: "#F5A623",
  cheque: "#9AA3AD",
};
const METHOD_LABEL: Record<string, string> = { card: "Card", cash: "Cash", juice: "Juice", bank_transfer: "Bank transfer", cheque: "Cheque" };
const STATUS_TONE: Record<string, TcBadgeTone> = {
  paid: "attention",
  accepted: "attention",
  issued: "outline",
  partly_paid: "outline",
  void: "danger",
  declined: "danger",
};

function Kpi({ icon: Icon, value, label, tile }: { icon: typeof ReceiptText; value: string; label: string; tile: string }) {
  return (
    <TcCard className="p-5">
      <span className={`grid size-9 place-items-center rounded-[11px] ${tile}`}>
        <Icon className="size-[18px]" />
      </span>
      <div className="mt-4 font-display text-[20px] font-medium leading-tight tracking-[-0.6px] text-tc-ink min-[400px]:text-[24px] sm:text-[28px]">{value}</div>
      <div className="mt-1 text-[13px] text-tc-muted">{label}</div>
    </TcCard>
  );
}

/** The tyre-centre /dashboard: Carfectionist's dashboard — same figures, same sections —
 *  in the tyre-centre colours, with the header the brand's shell leaves to each page. */
export async function TyreDashboard({ searchParams }: { searchParams: SalesSearchParams }) {
  const params = normalizeSalesPeriodInput(searchParams);
  const sb = await createClient();
  const [d, session, bs] = await Promise.all([
    getDashboard(params),
    getSessionContext(),
    sb.from("business_settings").select("trading_name, legal_name").limit(1).maybeSingle(),
  ]);
  const name = (session?.displayName ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = ((bs.data as any)?.trading_name || (bs.data as any)?.legal_name || "") as string;
  const canSell = session ? hasModule(session.role, session.modules, "/sales") : false;

  const methodTotal = d.byMethod.reduce((s, m) => s + m.cents, 0) || 1;
  let acc = 0;
  const stops = d.byMethod
    .map((m) => {
      const start = (acc / methodTotal) * 360;
      acc += m.cents;
      return `${METHOD_COLOR[m.method] ?? "#C4CCD6"} ${start}deg ${(acc / methodTotal) * 360}deg`;
    })
    .join(",");
  const bestMax = d.bestServices[0]?.cents ?? 1;

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {shop && <div className={TC_MICRO}>{shop} / Overview</div>}
          <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.6px] text-tc-ink">
            Welcome back{name ? `, ${name}` : ""}
          </h1>
          <div className="mt-1 font-mono text-[12px] text-tc-muted">{muDayLabel(new Date().toISOString())}</div>
        </div>
        {canSell && (
          <Link
            href="/sales/counter"
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-tc-primary px-4 text-[14px] font-semibold text-white hover:opacity-95"
          >
            <Plus className="size-4" strokeWidth={2.4} /> New sale
          </Link>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi icon={ReceiptText} value={formatMUR(d.invoicedCents)} label="Invoiced (issued)" tile="bg-tc-primary text-tc-highlight" />
        <Kpi icon={Banknote} value={formatMUR(d.collectedCents)} label="Collected" tile="bg-[#E1F6EF] text-tc-success" />
        <Kpi icon={Clock} value={formatMUR(d.outstandingCents)} label="Outstanding" tile="bg-[#FFF2DB] text-[#C98200]" />
        <Kpi icon={FileText} value={String(d.docCount)} label="Invoices" tile="bg-[#E6F1FF] text-[#1E6FE0]" />
      </div>

      <SalesPerformanceChart data={d.salesPerformance} tone="tyrecentre" />

      {/* Collected by method + catalogue */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,400px)_1fr]">
        <TcCard className="p-5" aria-labelledby="tc-methods">
          <h2 id="tc-methods" className="text-[15px] font-bold text-tc-ink">
            Collected by method
          </h2>
          <div className="mt-0.5 text-[12.5px] text-tc-muted">All recorded payments</div>
          {d.byMethod.length === 0 ? (
            <div className="py-10 text-center text-[13.5px] text-tc-faint">No payments recorded yet.</div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
              <div className="relative grid size-[136px] shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${stops})` }}>
                <div className="grid size-[100px] place-items-center rounded-full bg-white">
                  <span className="max-w-[94px] text-center font-mono text-[12px] font-semibold leading-tight tabular-nums text-tc-ink">{formatMUR(d.collectedCents)}</span>
                </div>
              </div>
              <div className="flex min-w-[176px] flex-col gap-2.5">
                {d.byMethod.map((m) => (
                  <div key={m.method} className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-[3px]" style={{ background: METHOD_COLOR[m.method] ?? "#C4CCD6" }} />
                    <span className="flex-1 text-[13px] text-tc-body">{METHOD_LABEL[m.method] ?? m.method}</span>
                    <span className="font-mono text-[12.5px] font-semibold tabular-nums text-tc-ink">{formatMUR(m.cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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

      {/* Recent + best sellers */}
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
