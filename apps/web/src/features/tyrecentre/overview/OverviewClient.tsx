"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Car, Receipt, RefreshCw, Wallet } from "lucide-react";
import { NumberFlow } from "@/components/ui/number-flow";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { TcBadge } from "@/components/tyrecentre/TcBadge";
import { Segmented } from "@/components/tyrecentre/primitives";
import { TC_ROUND } from "@/components/tyrecentre/tc";
import { ENTITY, entityColours, entityVars } from "@/lib/tyrecentre/entity-colours";
import { formatMUR } from "@/lib/money";
import { shortDay } from "@/features/tyrecentre/dashboard-series";
import {
  onSiteLabel,
  periodSummary,
  type BayRow,
  type BayTab,
  type Collected,
  type OvCompany,
  type SalesByCompany,
  type TodayCompany,
} from "@/features/tyrecentre/overview-model";

/** A company's colour in the charts: the first is ink (black, light on dark), the rest their accent —
 *  the Overview's dot chart rule (DESIGN-SPEC §6.2). */
export const barColour = (i: number) => (i === 0 ? "var(--color-tc-ink)" : entityColours(i).accent);

const WHOLE: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
const rupees = (cents: number) => Math.round(cents / 100);

function Change({ value, label }: { value: number | null; label?: string }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`rounded-full px-[7px] py-[2px] text-[11.5px] font-bold tabular-nums ${up ? "bg-tc-highlight text-tc-on-highlight" : "bg-tc-sub text-tc-body"}`}
      >
        {up ? "↑" : "↓"} {Math.abs(value * 100).toFixed(1)}%
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}

function Stat({ head, value, foot, style }: { head: React.ReactNode; value: React.ReactNode; foot: React.ReactNode; style?: CSSProperties }) {
  return (
    <TcCard className="flex min-w-0 flex-col gap-2.5 !rounded-[20px] px-[18px] py-4" style={style}>
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-tc-muted">{head}</div>
      <div className="font-display text-[28px] font-medium leading-none tracking-[-0.8px] text-tc-ink tabular-nums">{value}</div>
      <div className="flex min-h-[22px] items-center gap-1.5 text-[11.5px] text-tc-muted">{foot}</div>
    </TcCard>
  );
}

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank", cheque: "Cheque", points: "Points" };
const METHOD_BAR = ["bg-tc-primary", "bg-tc-faint", "bg-tc-highlight", "bg-tc-track"];

/** Today so far: one card per company (against the same time last week), money in, cars, money owed. */
export function TodayStrip({
  companies,
  today,
  collected,
  bays,
  owed,
}: {
  companies: OvCompany[];
  today: TodayCompany[] | null;
  collected: Collected | null;
  bays: Record<BayTab, BayRow[]> | null;
  owed: { cents: number; count: number; oldestDays: number | null } | null;
}) {
  const ready = bays?.onsite.filter((r) => r.status.tone === "attention").length ?? 0;
  const onsite = bays?.onsite.length ?? 0;
  const several = companies.length > 1;
  return (
    <div data-tour="stats" className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
      {companies.map((c, i) => {
        const t = today?.[i];
        return (
          <Stat
            key={c.id || i}
            style={entityVars(i)}
            head={
              <>
                <span className="size-2.5 shrink-0 rounded-[3px] bg-[var(--e-accent)]" />
                <span className="min-w-0 flex-1 truncate">{several ? c.name : "Sales today"}</span>
                {several && <span className={`font-mono text-[10px] font-semibold ${ENTITY.ink}`}>{c.vatRegistered ? "VAT" : "NO VAT"}</span>}
              </>
            }
            value={t ? <NumberFlow value={rupees(t.cents)} prefix="Rs " format={WHOLE} locales="en-US" /> : "—"}
            foot={
              t ? (
                <>
                  <Change value={t.change} />
                  <span>
                    {t.invoices} sale{t.invoices === 1 ? "" : "s"} today
                  </span>
                </>
              ) : (
                <span>Couldn&apos;t load today&apos;s sales</span>
              )
            }
          />
        );
      })}
      <Stat
        head={
          <>
            <Wallet className="size-3.5 shrink-0 text-tc-body" />
            Collected today
          </>
        }
        value={collected ? <NumberFlow value={rupees(collected.totalCents)} prefix="Rs " format={WHOLE} locales="en-US" /> : "—"}
        foot={
          collected && collected.byMethod.length > 0 ? (
            <div className="flex w-full flex-col gap-1.5">
              <div className="flex h-1.5 gap-0.5" aria-hidden>
                {collected.byMethod.map((m, i) => (
                  <div key={m.method} className={`rounded-[3px] ${METHOD_BAR[Math.min(i, METHOD_BAR.length - 1)]}`} style={{ flex: m.cents }} />
                ))}
              </div>
              <span className="truncate text-[11px]">
                {collected.byMethod
                  .map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${Math.round((m.cents / Math.max(1, collected.byMethod.reduce((s, x) => s + x.cents, 0))) * 100)}%`)
                  .join(" · ")}
              </span>
            </div>
          ) : (
            <span>Nothing taken yet today</span>
          )
        }
      />
      <Stat
        head={
          <>
            <Car className="size-3.5 shrink-0 text-tc-body" />
            Cars in the bays
          </>
        }
        value={<NumberFlow value={onsite} locales="en-US" />}
        foot={
          bays ? (
            <>
              {ready > 0 && <TcBadge tone="attention">{ready} ready to pay</TcBadge>}
              <span>{onsite - ready > 0 ? `${onsite - ready} in work` : onsite === 0 ? "No cars on site" : ""}</span>
            </>
          ) : (
            <span>Couldn&apos;t load the board</span>
          )
        }
      />
      <Stat
        head={
          <>
            <Receipt className="size-3.5 shrink-0 text-tc-body" />
            Money owed
          </>
        }
        value={owed ? <NumberFlow value={rupees(owed.cents)} prefix="Rs " format={WHOLE} locales="en-US" /> : "—"}
        foot={
          owed && owed.count > 0 ? (
            <span>
              {owed.count} invoice{owed.count === 1 ? "" : "s"}
              {owed.oldestDays != null && (
                <>
                  {" · oldest "}
                  <b className={owed.oldestDays > 7 ? "font-bold text-tc-danger-ink" : "font-semibold text-tc-body"}>
                    {owed.oldestDays} day{owed.oldestDays === 1 ? "" : "s"}
                  </b>
                </>
              )}
            </span>
          ) : (
            <span>{owed ? "Every invoice is paid" : "Couldn't load invoices"}</span>
          )
        }
      />
    </div>
  );
}

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;
type Range = (typeof RANGES)[number]["value"];

/** Sales over 7 / 30 / 90 days: the period's total, each company's share and VAT, and one stacked
 *  bar per day in the companies' colours. Today's bar is ringed in lime. */
export function SalesCard({ companies, sales }: { companies: OvCompany[]; sales: SalesByCompany | null }) {
  const [range, setRange] = useState<Range>("30");
  const n = Number(range);
  const p = useMemo(() => (sales ? periodSummary(sales, n) : null), [sales, n]);
  const several = companies.length > 1;
  const totals = p ? p.days.map((_, i) => p.perCompanyDaily.reduce((s, c) => s + Math.max(0, c[i]), 0)) : [];
  const max = Math.max(1, ...totals);
  const lastIndex = totals.length - 1;
  const labelAt = new Set(p ? (n === 7 ? p.days.map((_, i) => i) : [0, Math.round(lastIndex / 4), Math.round(lastIndex / 2), Math.round((3 * lastIndex) / 4)]) : []);

  return (
    <TcCard className="flex flex-col gap-4 px-[22px] py-5" aria-labelledby="tc-sales">
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
        <h2 id="tc-sales" className="text-[14px] font-bold text-tc-ink">
          Sales
        </h2>
        {several &&
          companies.map((c, i) => (
            <span key={c.id || i} className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-tc-muted sm:inline-flex">
              <span className="size-[7px] rounded-full" style={{ background: barColour(i) }} />
              {c.name}
            </span>
          ))}
        <span className="flex-1" />
        <Segmented label="Sales period" value={range} onChange={setRange} options={[...RANGES]} />
        <Link href="/reports/sales-journal" className="hidden text-[13px] text-tc-body hover:text-tc-ink md:inline">
          Open sales journal →
        </Link>
      </div>

      {!p ? (
        <div className="py-12 text-center text-[13.5px] text-tc-faint">Couldn&apos;t load sales. Refresh to try again.</div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-7">
          <div className="flex shrink-0 flex-col gap-2 lg:w-[300px]">
            <div className="font-display text-[44px] font-light leading-[1.05] tracking-[-2px] text-tc-ink tabular-nums sm:text-[52px]">
              <NumberFlow value={rupees(p.totalCents)} format={WHOLE} locales="en-US" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-tc-muted">
              <Change value={p.change} />
              <span>
                {p.change != null ? `vs the ${n} days before · ` : `Last ${n} days · `}Rs, VAT incl.
              </span>
            </div>
            <dl className="mt-1.5 flex flex-col">
              {several &&
                companies.map((c, i) => (
                  <div key={c.id || i} className="flex justify-between gap-3 border-b border-dashed border-tc-line-2 py-[9px] text-[13px]">
                    <dt className="truncate text-tc-body">{c.name}</dt>
                    <dd className="font-mono font-semibold tabular-nums text-tc-ink">{formatMUR(p.perCompanyCents[i]).replace(/^Rs /, "")}</dd>
                  </div>
                ))}
              <div className="flex justify-between gap-3 py-[9px] text-[13px]">
                <dt className="text-tc-body">VAT collected</dt>
                <dd className="font-mono font-semibold tabular-nums text-tc-ink">{formatMUR(p.vatCents).replace(/^Rs /, "")}</dd>
              </div>
            </dl>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className={`flex h-[196px] items-end border-b border-tc-line ${n === 90 ? "gap-[2px]" : n === 30 ? "gap-[5px]" : "gap-3"}`} aria-hidden>
              {p.days.map((day, d) => {
                const isToday = d === lastIndex;
                const tip = [`${shortDay(day)}: ${formatMUR(totals[d])}`, ...(several ? companies.map((c, i) => `${c.name} ${formatMUR(p.perCompanyDaily[i][d])}`) : [])].join("\n");
                return (
                  <div
                    key={day}
                    title={tip}
                    className={`flex min-w-0 flex-1 flex-col-reverse gap-[2px] ${isToday ? "rounded-[6px] bg-tc-highlight p-[3px]" : ""}`}
                    style={{ height: totals[d] > 0 ? `${Math.max(2, (totals[d] / max) * 100)}%` : undefined }}
                  >
                    {companies.map((c, i) => {
                      const v = Math.max(0, p.perCompanyDaily[i][d]);
                      return v > 0 ? <div key={c.id || i} className="min-h-[2px] rounded-[3px]" style={{ flex: v, background: barColour(i) }} /> : null;
                    })}
                  </div>
                );
              })}
            </div>
            <div className={`flex font-mono text-[10px] uppercase tracking-[0.06em] text-tc-fainter ${n === 90 ? "gap-[2px]" : n === 30 ? "gap-[5px]" : "gap-3"}`} aria-hidden>
              {p.days.map((day, d) => (
                <div key={day} className="relative min-w-0 flex-1 whitespace-nowrap">
                  {d === lastIndex ? (
                    <span className="absolute right-0 font-bold text-tc-ink">Today</span>
                  ) : labelAt.has(d) && d < lastIndex - (n === 7 ? 0 : 3) ? (
                    <span className={n === 7 ? "" : "absolute left-0"}>{shortDay(day)}</span>
                  ) : null}
                </div>
              ))}
            </div>
            <table className="sr-only">
              <caption>Sales per day, rupees incl. VAT</caption>
              <thead>
                <tr>
                  <th>Day</th>
                  {companies.map((c, i) => (
                    <th key={c.id || i}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.days.map((day, d) => (
                  <tr key={day}>
                    <td>{shortDay(day)}</td>
                    {companies.map((c, i) => (
                      <td key={c.id || i}>{formatMUR(p.perCompanyDaily[i][d])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </TcCard>
  );
}

const TABS: { key: BayTab; label: string; empty: string }[] = [
  { key: "onsite", label: "On site", empty: "No cars on site right now." },
  { key: "booked", label: "Booked", empty: "Nothing booked for today." },
  { key: "handed", label: "Handed back", empty: "No car handed back yet today." },
];

/** "Tyre Centre Ltd" → "Tyre Centre": a company chip in a table row has room for two words, not three. */
const shortName = (name: string | undefined) =>
  (name ?? "—").replace(/\s+(ltd|limited|co\.?|company|inc\.?)\.?$/i, "").split(/\s+/).slice(0, 2).join(" ");

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** The job board at a glance: car, technician, the four stages, which companies bill it, status. */
export function BaysCard({ bays, companies }: { bays: Record<BayTab, BayRow[]> | null; companies: OvCompany[] }) {
  const [tab, setTab] = useState<BayTab>("onsite");
  const rows = bays?.[tab] ?? [];
  const several = companies.length > 1;
  return (
    <TcCard className="flex flex-col gap-1 px-5 pb-2.5 pt-[18px]" aria-labelledby="tc-bays">
      <div className="flex items-center gap-2.5">
        <h2 id="tc-bays" className="flex-1 text-[14px] font-bold text-tc-ink">
          In the bays
        </h2>
        <Link href="/jobs" className="text-[12.5px] text-tc-muted hover:text-tc-ink">
          Job board →
        </Link>
      </div>
      <div role="tablist" aria-label="Jobs" className="flex gap-[18px] border-b border-tc-line pt-2 text-[12.5px]">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 pb-2 ${tab === t.key ? "border-tc-primary font-bold text-tc-ink" : "border-transparent text-tc-muted hover:text-tc-ink"}`}
          >
            {t.label} <span className="font-medium text-tc-faint">{bays?.[t.key].length ?? 0}</span>
          </button>
        ))}
      </div>
      {!bays ? (
        <div className="py-10 text-center text-[13.5px] text-tc-faint">Couldn&apos;t load the job board.</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-[13.5px] text-tc-faint">{TABS.find((t) => t.key === tab)!.empty}</div>
      ) : (
        <div role="table" aria-label={`${TABS.find((t) => t.key === tab)!.label} jobs`}>
          <div role="row" className="flex items-center gap-3 whitespace-nowrap pb-1.5 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-tc-fainter">
            <div role="columnheader" className="min-w-0 flex-1 md:w-[196px] md:flex-none">Car</div>
            <div role="columnheader" className="hidden w-[34px] shrink-0 md:block 2xl:w-[104px]"><span className="2xl:hidden">Tech</span><span className="hidden 2xl:inline">Technician</span></div>
            <div role="columnheader" className="hidden w-[96px] shrink-0 sm:block">Stage</div>
            {several && <div role="columnheader" className="hidden min-w-0 flex-1 lg:block">Bills to</div>}
            <div role="columnheader" className="w-[118px] shrink-0 text-right">Status</div>
            <div role="columnheader" className="hidden w-[56px] shrink-0 text-right sm:block">On site</div>
          </div>
          {rows.map((r) => (
            <Link key={r.id} href={`/jobs/${r.id}`} role="row" className="-mx-2 flex items-center gap-3 rounded-[12px] border-t border-tc-line px-2 py-2.5 hover:bg-tc-sub">
              <div role="cell" className="flex min-w-0 flex-1 items-center gap-2.5 md:w-[196px] md:flex-none">
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-tc-sub">
                  <Car className="size-4 text-tc-body" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-bold text-tc-ink">{r.plate}</span>
                  <span className="truncate font-mono text-[10.5px] text-tc-faint">{r.detail || "—"}</span>
                </span>
              </div>
              <div role="cell" title={r.technician ?? "Unassigned"} className="hidden w-[34px] shrink-0 items-center gap-[7px] md:flex 2xl:w-[104px]">
                {r.technician ? (
                  <>
                    <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#2B8CFF,#6A5CFF)] text-[9px] font-bold text-white">
                      {initials(r.technician)}
                    </span>
                    <span className="hidden truncate text-[12.5px] text-tc-body 2xl:inline">{r.technician}</span>
                  </>
                ) : (
                  <>
                    <span className="grid size-[22px] shrink-0 place-items-center rounded-full border border-dashed border-tc-line-2 text-[10px] text-tc-faint 2xl:hidden">?</span>
                    <span className="hidden truncate text-[12.5px] text-tc-faint 2xl:inline">Unassigned</span>
                  </>
                )}
              </div>
              <div role="cell" className="hidden w-[96px] shrink-0 gap-[3px] sm:flex" aria-label={`Stage ${r.stage} of 4${r.blocked ? ", paused" : ""}`}>
                {[1, 2, 3, 4].map((s) => (
                  <span
                    key={s}
                    className={`h-2.5 w-[21px] rounded-[3px] ${s <= r.stage ? (r.blocked && s === r.stage ? "bg-tc-danger" : "bg-tc-primary") : "bg-tc-track"}`}
                  />
                ))}
              </div>
              {several && (
                <div role="cell" className="hidden min-w-0 flex-1 gap-[5px] lg:flex">
                  {r.companies.map((i) => (
                    <span key={i} title={companies[i]?.name} className="min-w-0">
                      <TcBadge tone="entity" entityIndex={i} className="max-w-[120px] truncate">
                        {shortName(companies[i]?.name)}
                      </TcBadge>
                    </span>
                  ))}
                </div>
              )}
              <div role="cell" className="flex w-[118px] shrink-0 justify-end">
                <TcBadge tone={r.status.tone} className={r.status.tone === "attention" || r.status.tone === "danger" ? "font-bold" : ""}>
                  {r.status.tone === "outline" && r.status.label === "In progress" ? "● " : ""}
                  {r.status.label}
                </TcBadge>
              </div>
              <div role="cell" className="hidden w-[56px] shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-tc-muted sm:block">
                {r.minutes != null ? onSiteLabel(r.minutes) : "—"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </TcCard>
  );
}

/** Re-reads every figure on the page (a server refresh — no client cache to go stale). */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" aria-label="Refresh the figures" onClick={() => start(() => router.refresh())} className={TC_ROUND}>
      <RefreshCw className={`size-[15px] ${pending ? "animate-spin" : ""}`} />
    </button>
  );
}
