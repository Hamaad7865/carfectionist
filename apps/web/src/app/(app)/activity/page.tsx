import Link from "next/link";
import { ReceiptText, Banknote, Package, Wallet, Wrench, ShieldCheck, AlertTriangle, Circle, type LucideIcon } from "lucide-react";
import { getActivity, ACTIVITY_CATEGORIES, type ActivityTone } from "@/lib/supabase/queries/activity";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { PersonFilter } from "@/features/activity/PersonFilter";
import { formatMUR } from "@/lib/money";

const TONE: Record<ActivityTone, { icon: LucideIcon; color: string; bg: string }> = {
  sale: { icon: ReceiptText, color: "#1e6fe0", bg: "rgba(43,140,255,0.12)" },
  money: { icon: Banknote, color: "#0da77c", bg: "rgba(13,167,124,0.12)" },
  stock: { icon: Package, color: "#6a5cff", bg: "rgba(106,92,255,0.12)" },
  cash: { icon: Wallet, color: "#b07c14", bg: "rgba(245,166,35,0.16)" },
  job: { icon: Wrench, color: "#6f5cd9", bg: "rgba(111,92,217,0.12)" },
  admin: { icon: ShieldCheck, color: "#3d4a59", bg: "rgba(15,23,32,0.07)" },
  warn: { icon: AlertTriangle, color: "#d63b50", bg: "rgba(214,59,80,0.1)" },
  neutral: { icon: Circle, color: "#8c96a1", bg: "rgba(15,23,32,0.05)" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 4 * 3600_000); // Mauritius +04
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; actor?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  const { events, actors, capped } = await getActivity({ from: sp.from, to: sp.to, actor: sp.actor, category: sp.cat });

  const qs = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { from: sp.from, to: sp.to, actor: sp.actor, cat: sp.cat, ...overrides };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const chip = (on: boolean) =>
    `inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-[12px] font-semibold ${on ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"}`;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h2 className="font-display text-[19px] font-extrabold text-ink-strong sm:text-[20px]">Activity</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Everything that happened across the back office and the tablet POS — who did what, when.</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/activity${qs({ cat: undefined })}`} className={chip(!sp.cat)}>All</Link>
          {ACTIVITY_CATEGORIES.map((c) => (
            <Link key={c.key} href={`/activity${qs({ cat: c.key })}`} className={chip(sp.cat === c.key)}>{c.label}</Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PersonFilter actors={actors} current={sp.actor} />
          <DateRangeFilter label={false} />
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        {events.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">No activity for this filter.</div>
        ) : (
          events.map((e) => {
            const tone = TONE[e.tone];
            const Icon = tone.icon;
            const inner = (
              <>
                <span className="grid size-8 shrink-0 place-items-center rounded-[9px]" style={{ background: tone.bg, color: tone.color }}>
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-semibold text-ink">{e.title}</span>
                    {e.detail && e.detail !== "—" && <span className="truncate text-[11.5px] text-muted">{e.detail}</span>}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-faint">
                    <span className="font-semibold text-th">{e.actorName}</span> · {fmtWhen(e.at)}
                  </div>
                </div>
                {e.amountCents != null && <span className="num shrink-0 text-[13px] font-bold text-ink">{formatMUR(e.amountCents)}</span>}
              </>
            );
            const cls = "flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0";
            return e.href ? (
              <Link key={e.id} href={e.href} className={`${cls} hover:bg-sub`}>{inner}</Link>
            ) : (
              <div key={e.id} className={cls}>{inner}</div>
            );
          })
        )}
        {capped && (
          <div className="bg-band px-4 py-2.5 text-center text-[11.5px] text-th">Showing the 300 most recent — narrow the date range to see more.</div>
        )}
      </div>
    </div>
  );
}
