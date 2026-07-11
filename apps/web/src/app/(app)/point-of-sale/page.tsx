import { Store, Download } from "lucide-react";
import { getPosOverview } from "@/lib/supabase/queries/pos-devices";
import { getSessionContext } from "@/lib/auth/session";
import { DeviceCard } from "@/features/pos/DeviceCards";
import { ClosePeriodButton } from "@/features/pos/ClosePeriodButton";
import { monthLabel } from "@/features/pos/month-label";
import { formatMUR } from "@/lib/money";
import { muDate } from "@/lib/mu-date";

export default async function PointOfSalePage() {
  const [data, session] = await Promise.all([getPosOverview(), getSessionContext()]);
  const isOwner = session?.role === "owner";

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* Header — mirrors the owner's Cashmag reference: DEVICES — <company> + count */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="border-l-[3px] border-brand pl-3.5">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-faint">Devices</div>
          <h2 className="font-display text-[22px] font-extrabold uppercase tracking-wide text-ink-strong">{data.tradingName}</h2>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {data.deviceCount} registered device{data.deviceCount === 1 ? "" : "s"}
            {" · "}web back office
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {data.periods.lastClosed && (
            <span className="rounded-[10px] border border-line bg-sub px-3 py-1.5 text-[12px] font-semibold text-muted">
              Last closed month · <span className="text-body">{monthLabel(data.periods.lastClosed)}</span>
            </span>
          )}
          {isOwner && data.periods.closable && <ClosePeriodButton period={data.periods.closable} />}
        </div>
      </div>

      {/* Caisses — active devices */}
      <div>
        <div className="mb-2.5 flex items-center gap-2">
          <Store size={15} className="text-faint" />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Tills · active devices</span>
        </div>
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {data.devices.map((d) => (
            <DeviceCard key={d.code} device={d} />
          ))}
        </div>
      </div>

      {/* Recent cash-ups (moved here from Reports) */}
      {data.recent.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Recent cash-ups</span>
            <a href="/api/reports/cash/csv" className="flex h-7 items-center gap-1.5 rounded-lg border border-line-2 bg-card px-2.5 text-[11.5px] font-semibold text-body hover:border-brand">
              <Download size={13} /> CSV
            </a>
          </div>
          <div className="hidden grid-cols-[1fr_120px_110px_110px_110px] gap-3 border-b border-line bg-band px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th md:grid">
            <span>Opened</span><span>Device</span><span className="text-right">Expected</span><span className="text-right">Counted</span><span className="text-right">Variance</span>
          </div>
          {data.recent.map((s) => (
            <div key={s.id} className="border-b border-line px-4 py-3 md:px-5">
              {/* Mobile card */}
              <div className="flex items-center justify-between gap-3 md:hidden">
                <div>
                  <div className="num text-[12.5px] font-semibold text-body">{muDate(s.openedAt)} · {s.deviceCode}</div>
                  <div className="num mt-0.5 text-[11.5px] text-muted">Counted {formatMUR(s.countedCents)}</div>
                </div>
                <span className={`num text-[13px] font-bold ${s.varianceCents === 0 ? "text-mint" : s.varianceCents < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(s.varianceCents)}</span>
              </div>
              {/* Desktop grid */}
              <div className="hidden grid-cols-[1fr_120px_110px_110px_110px] items-center gap-3 text-[12.5px] md:grid">
                <span className="num text-muted">{muDate(s.openedAt)}</span>
                <span className="num text-body">{s.deviceCode}</span>
                <span className="num text-right text-body">{formatMUR(s.expectedCents)}</span>
                <span className="num text-right text-body">{formatMUR(s.countedCents)}</span>
                <span className={`num text-right font-bold ${s.varianceCents === 0 ? "text-mint" : s.varianceCents < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(s.varianceCents)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
