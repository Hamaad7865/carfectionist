import Link from "next/link";
import { ReceiptText, Banknote, Clock, FileText, Package, Users, MapPin, Wrench } from "lucide-react";
import { getDashboard } from "@/lib/supabase/queries/dashboard";
import { getSessionContext } from "@/lib/auth/session";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMUR } from "@/lib/money";

const card = "rounded-[15px] border border-line bg-card";
const METHOD_COLOR: Record<string, string> = {
  card: "#2b8cff",
  cash: "#0da77c",
  juice: "#6a5cff",
  bank_transfer: "#f5a623",
};
const METHOD_LABEL: Record<string, string> = { card: "Card", cash: "Cash", juice: "Juice", bank_transfer: "Bank transfer" };

function Kpi({ icon: Icon, value, label, tint }: { icon: typeof ReceiptText; value: string; label: string; tint: string }) {
  return (
    <div className={`${card} p-[17px]`}>
      <span className="grid size-[34px] place-items-center rounded-[10px]" style={{ background: `${tint}22`, color: tint }}>
        <Icon size={18} />
      </span>
      <div className="num mt-3.5 text-[27px] font-extrabold tracking-tight text-ink-strong">{value}</div>
      <div className="mt-0.5 text-[12px] font-medium text-muted">{label}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const [d, session] = await Promise.all([getDashboard(), getSessionContext()]);
  const name = (session?.displayName ?? "").replace(/\s*\(.*\)\s*$/, "").trim();

  const methodTotal = d.byMethod.reduce((s, m) => s + m.cents, 0) || 1;
  let acc = 0;
  const stops = d.byMethod
    .map((m) => {
      const start = (acc / methodTotal) * 360;
      acc += m.cents;
      const end = (acc / methodTotal) * 360;
      return `${METHOD_COLOR[m.method] ?? "#8c96a1"} ${start}deg ${end}deg`;
    })
    .join(",");

  const bestMax = d.bestServices[0]?.cents ?? 1;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">
          Welcome back{name ? `, ${name}` : ""}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Live figures below read straight from the database through row-level security.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi icon={ReceiptText} value={formatMUR(d.invoicedCents)} label="Invoiced (issued)" tint="#2b8cff" />
        <Kpi icon={Banknote} value={formatMUR(d.collectedCents)} label="Collected" tint="#0da77c" />
        <Kpi icon={Clock} value={formatMUR(d.outstandingCents)} label="Outstanding" tint="#f5a623" />
        <Kpi icon={FileText} value={String(d.docCount)} label="Invoices" tint="#6a5cff" />
      </div>

      {/* Collected by method + catalogue */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,400px)_1fr]">
        <div className={`${card} p-5`}>
          <div className="font-display text-[14px] font-bold text-ink">Collected by method</div>
          <div className="mt-0.5 text-[11.5px] text-muted">All recorded payments</div>
          {d.byMethod.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-faint">No payments recorded yet.</div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4">
              <div className="relative grid size-[136px] shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${stops})` }}>
                <div className="grid size-[100px] place-items-center rounded-full bg-card">
                  <span className="num max-w-[94px] text-center text-[12px] font-extrabold leading-tight text-ink-strong">{formatMUR(d.collectedCents)}</span>
                </div>
              </div>
              <div className="flex min-w-[176px] flex-col gap-2.5">
                {d.byMethod.map((m) => (
                  <div key={m.method} className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-[3px]" style={{ background: METHOD_COLOR[m.method] ?? "#8c96a1" }} />
                    <span className="flex-1 text-[12px] font-semibold text-body">{METHOD_LABEL[m.method] ?? m.method}</span>
                    <span className="num text-[12px] font-bold text-ink">{formatMUR(m.cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <div className="font-display text-[14px] font-bold text-ink">Catalogue &amp; team</div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-[12.5px]">
            {[
              { icon: Wrench, label: "Services", value: d.counts.services },
              { icon: Package, label: "Stocked products", value: d.counts.stocked },
              { icon: MapPin, label: "Locations", value: d.counts.locations },
              { icon: Users, label: "Team", value: d.counts.team },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2.5 rounded-[11px] bg-sub px-3 py-2.5">
                <r.icon size={16} className="text-link" />
                <span className="flex-1 text-muted">{r.label}</span>
                <span className="num font-bold text-ink">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent + best sellers */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className={`${card} p-5`}>
          <div className="mb-3.5 flex items-center justify-between">
            <span className="font-display text-[14px] font-bold text-ink">Recent documents</span>
            <Link href="/sales" className="text-[11.5px] font-semibold text-link">View all →</Link>
          </div>
          {d.recent.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-faint">No documents yet.</div>
          ) : (
            <div className="flex flex-col">
              {d.recent.map((r) => (
                <Link key={r.id} href={`/sales/${r.id}`} className="flex items-center gap-2.5 rounded-[9px] px-1.5 py-2 hover:bg-sub">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-body">{r.customer ?? "—"}</div>
                    <div className="num text-[10.5px] text-faint">{r.number ?? "Draft"} · {r.date}</div>
                  </div>
                  <span className="num text-[12px] font-bold text-ink">{formatMUR(r.totalCents)}</span>
                  <StatusPill status={r.status} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <div className="mb-4 font-display text-[14px] font-bold text-ink">Best-selling services</div>
          {d.bestServices.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-faint">Sales analytics activate as invoices are paid.</div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {d.bestServices.map((s, i) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="num w-5 text-[13px] font-extrabold text-link">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-body">{s.name}</div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-[3px] bg-[rgba(15,23,32,0.06)]">
                      <div className="h-full rounded-[3px]" style={{ width: `${Math.round((s.cents / bestMax) * 100)}%`, background: "#10b5aa" }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[12px] font-bold text-ink">{formatMUR(s.cents)}</div>
                    <div className="text-[10px] text-faint">{s.qty} sold</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
