"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowRight, ArrowUp, ArrowDown, CarFront, CircleDot, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TcBadge } from "@/components/tyrecentre/TcBadge";
import { Segmented } from "@/components/tyrecentre/primitives";
import { TC_MICRO, TC_ROUND } from "@/components/tyrecentre/tc";
import { TcCard } from "@/components/tyrecentre/TcCard";
import { formatRupeesWhole } from "@/lib/money";
import { entityColours } from "@/lib/tyrecentre/entity-colours";
import type { OverviewRange } from "./overview-model";
import { muClock } from "./overview-model";
import { DotChart } from "./DotChart";
import type { BayRow, NeedsItem, TyreOverview } from "@/lib/supabase/queries/tyrecentre-overview";

const RANGES: { value: OverviewRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];
const PERIOD: Record<OverviewRange, string> = { today: "today", "7d": "· 7 days", "30d": "· 30 days" };

export interface OverviewAccess {
  canSell: boolean;
  canJournal: boolean;
  canJobs: boolean;
}

export function Overview({ data, shopLabel, access }: { data: TyreOverview; shopLabel: string; access: OverviewAccess }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const setRange = (r: OverviewRange) => startTransition(() => router.push(r === "today" ? pathname : `${pathname}?range=${r}`));
  const companyNames = data.companies.map((c) => c.name);

  return (
    <div className="flex flex-col gap-3.5 px-4 py-5 sm:px-6" aria-busy={pending}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className={TC_MICRO}>
            {shopLabel} / Overview
          </div>
          <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.6px] text-tc-ink">Overview</h1>
          <div className="mt-1 font-mono text-[12px] text-tc-muted">
            {data.dateLine} · {data.tillOpenSince ? `till open since ${data.tillOpenSince}` : "till closed"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented label="Period" value={data.range} onChange={setRange} options={RANGES} itemClassName="whitespace-nowrap" />
          <button type="button" aria-label="Refresh" onClick={() => startTransition(() => router.refresh())} className={TC_ROUND}>
            <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
          </button>
          {access.canSell && (
            <Link href="/sales/counter" className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-tc-primary px-4 text-[14px] font-semibold text-white hover:opacity-95">
              <Plus className="size-4" strokeWidth={2.4} /> New sale
            </Link>
          )}
        </div>
      </div>

      {/* Sales hero */}
      <TcCard className={`p-5 sm:p-[22px]`} aria-labelledby="tc-sales-title">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h2 id="tc-sales-title" className="text-[15px] font-bold text-tc-ink">
            Sales {PERIOD[data.range]}
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {data.companies.map((c, i) => (
              <span key={c.name} className={`${TC_MICRO} inline-flex items-center gap-1.5 text-tc-muted`}>
                <span className="size-2 rounded-full" style={{ background: i === 0 ? "#0F1720" : entityColours(i).accent }} />
                {c.name}
              </span>
            ))}
            {data.range === "today" && (
              <span className={`${TC_MICRO} inline-flex items-center gap-1.5 text-tc-muted`}>
                <span className="size-2 rounded-full border-[1.5px] border-tc-dot" /> Booked
              </span>
            )}
          </div>
          {access.canJournal && (
            <Link href="/sales-journal" className="ml-auto inline-flex items-center gap-1 text-[13.5px] font-medium text-tc-ink hover:underline">
              Open sales journal <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end">
          <div className="w-full shrink-0 lg:w-[330px]">
            <div className="font-display text-[52px] font-light leading-[1] tracking-[-2.5px] text-tc-ink sm:text-[64px]">
              {formatRupeesWhole(data.totalCents)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-tc-muted">
              {data.change != null && (
                <TcBadge tone={data.change >= 0 ? "attention" : "danger"}>
                  {data.change >= 0 ? <ArrowUp className="size-3" strokeWidth={2.6} /> : <ArrowDown className="size-3" strokeWidth={2.6} />}
                  {Math.abs(data.change).toFixed(1)}%
                </TcBadge>
              )}
              <span>
                {data.change != null ? `${data.compareLabel} · ` : ""}Rs, VAT incl.
              </span>
            </div>
            <dl className="mt-4">
              {data.companies.map((c) => (
                <div key={c.name} className="flex items-center justify-between border-b border-dashed border-[rgba(15,23,32,0.12)] py-2.5">
                  <dt className="truncate text-[14px] text-tc-body">{c.name}</dt>
                  <dd className="font-mono text-[13px] font-semibold tabular-nums text-tc-ink">{formatRupeesWhole(c.totalCents)}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[14px] text-tc-body">VAT collected</dt>
                <dd className="font-mono text-[13px] font-semibold tabular-nums text-tc-ink">{formatRupeesWhole(data.vatCents)}</dd>
              </div>
            </dl>
          </div>
          <DotChart chart={data.chart} companies={companyNames} periodLabel={PERIOD[data.range]} />
        </div>

        {data.tip && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] bg-tc-sub px-3 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-tc-primary text-tc-highlight">
              <Sparkles className="size-4" />
            </span>
            <p className="min-w-0 flex-1 text-[13px] text-tc-body">
              <b className="font-semibold text-tc-ink">{data.tip.emphasis}</b> {data.tip.text}
            </p>
            {data.tip.action && (
              <Link href={data.tip.action.href} className="inline-flex h-8 items-center rounded-full bg-tc-primary px-3.5 text-[13px] font-semibold text-white hover:opacity-95">
                {data.tip.action.label}
              </Link>
            )}
          </div>
        )}
      </TcCard>

      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Bays bays={data.bays} companies={data.companies.map((c) => c.name)} canJobs={access.canJobs} nowMs={data.nowMs} />
        <NeedsYou items={data.needs} />
      </div>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return <span className="font-mono text-[12px] text-tc-fainter">—</span>;
  return (
    <span className="flex items-center gap-[3px]" role="img" aria-label={`${done} of ${total} steps done`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-3 w-4 rounded-[3px] ${i < done ? "bg-tc-primary" : "bg-tc-track"}`} />
      ))}
    </span>
  );
}

function minutesSince(iso: string, nowMs: number): string {
  const m = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  return m < 60 ? `${String(m).padStart(2, "0")} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function StatusBadge({ row, nowMs }: { row: BayRow; nowMs: number }) {
  if (row.status === "ready") return <TcBadge tone="attention">Ready to pay</TcBadge>;
  if (row.status === "in_progress") return <TcBadge tone="outline">{row.paused ? "Paused" : "● In progress"}</TcBadge>;
  if (row.status === "delivered") return <TcBadge tone="neutral">Done{row.deliveredAt ? ` · ${muClock(Date.parse(row.deliveredAt))}` : ""}</TcBadge>;
  if (row.scheduledAt && Date.parse(row.scheduledAt) > nowMs) return <TcBadge tone="neutral">Booked · {muClock(Date.parse(row.scheduledAt))}</TcBadge>;
  return <TcBadge tone="neutral">Checked in · {minutesSince(row.checkedInAt, nowMs)}</TcBadge>;
}

function BayTable({ rows, companies, empty, nowMs }: { rows: BayRow[]; companies: string[]; empty: string; nowMs: number }) {
  const router = useRouter();
  if (rows.length === 0) return <p className="py-10 text-center text-[13px] text-tc-faint">{empty}</p>;
  const th = `${TC_MICRO} h-9 px-0 text-[10px] tracking-[0.1em] text-tc-fainter`;
  return (
    <Table className="min-w-[560px]">
      <TableHeader>
        <TableRow className="border-tc-line hover:bg-transparent">
          <TableHead className={th}>Car</TableHead>
          <TableHead className={th}>Progress</TableHead>
          <TableHead className={th}>Bills to</TableHead>
          <TableHead className={`${th} text-right`}>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow
            key={r.id}
            className="cursor-pointer border-tc-line hover:bg-tc-sub/60"
            onClick={() => router.push(`/jobs/${r.id}`)}
          >
            <TableCell className="px-0 py-3">
              <Link href={`/jobs/${r.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-tc-sub text-tc-body">
                  <CarFront className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-tc-ink">{r.plate}</span>
                  <span className="block max-w-[220px] truncate font-mono text-[10.5px] text-tc-faint">{r.summary || "—"}</span>
                </span>
              </Link>
            </TableCell>
            <TableCell className="px-0">
              <Progress done={r.stepsDone} total={r.stepsTotal} />
            </TableCell>
            <TableCell className="px-0">
              {r.billed ? (
                <span className="flex flex-wrap gap-1">
                  {companies.map((c, i) => (
                    <TcBadge key={c} tone="entity" entityIndex={i} className="max-w-[140px] truncate">
                      {c}
                    </TcBadge>
                  ))}
                </span>
              ) : (
                <span className="text-[12px] text-tc-fainter">Not billed yet</span>
              )}
            </TableCell>
            <TableCell className="px-0 text-right">
              <StatusBadge row={r} nowMs={nowMs} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Bays({ bays, companies, canJobs, nowMs }: { bays: TyreOverview["bays"]; companies: string[]; canJobs: boolean; nowMs: number }) {
  const all = bays.active.length + bays.ready.length;
  const tab = "h-8 flex-none px-0 text-[13.5px] text-tc-muted data-[state=active]:font-semibold data-[state=active]:text-tc-ink after:!bg-tc-primary";
  return (
    <TcCard className={`min-w-0 flex-1 p-5`} aria-labelledby="tc-bays-title">
      <Tabs defaultValue={bays.ready.length > 0 && bays.active.length === 0 ? "ready" : "active"} className="gap-0">
        <div className="flex items-center justify-between">
          <h2 id="tc-bays-title" className="text-[15px] font-bold text-tc-ink">
            In the bays
          </h2>
          {canJobs && (
            <Link href="/jobs" className="inline-flex items-center gap-1 text-[13px] text-tc-muted hover:text-tc-ink">
              All {all} <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
        <TabsList variant="line" className="mt-2 h-9 gap-5 border-b border-tc-line p-0">
          <TabsTrigger value="active" className={tab}>
            Active <span className="font-normal text-tc-faint">{bays.active.length}</span>
          </TabsTrigger>
          <TabsTrigger value="ready" className={tab}>
            Ready to pay <span className="font-normal text-tc-faint">{bays.ready.length}</span>
          </TabsTrigger>
          <TabsTrigger value="done" className={tab}>
            Done <span className="font-normal text-tc-faint">{bays.done.length}</span>
          </TabsTrigger>
        </TabsList>
        <div className="overflow-x-auto">
          <TabsContent value="active">
            <BayTable rows={bays.active} companies={companies} nowMs={nowMs} empty="No cars in the bays right now." />
          </TabsContent>
          <TabsContent value="ready">
            <BayTable rows={bays.ready} companies={companies} nowMs={nowMs} empty="Nothing waiting to be paid." />
          </TabsContent>
          <TabsContent value="done">
            <BayTable rows={bays.done} companies={companies} nowMs={nowMs} empty="No car handed back yet today." />
          </TabsContent>
        </div>
      </Tabs>
    </TcCard>
  );
}

function NeedsYou({ items }: { items: NeedsItem[] }) {
  return (
    <TcCard className={`w-full shrink-0 p-4 xl:w-[320px]`} aria-labelledby="tc-needs-title">
      <div className="flex items-center gap-2 px-1">
        <h2 id="tc-needs-title" className="text-[15px] font-bold text-tc-ink">
          Needs you
        </h2>
        {items.length > 0 && <TcBadge tone="attention">{items.length}</TcBadge>}
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-8 text-center text-[13px] text-tc-faint">Nothing needs you right now.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {items.map((n) => (
            <li key={n.key} className="rounded-[16px] border border-tc-line bg-tc-sidebar p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`${TC_MICRO} inline-flex items-center gap-1.5 text-[10px] text-tc-fainter`}>
                  <CircleDot className="size-3" /> {n.header}
                </span>
                <span className="font-mono text-[10px] text-tc-fainter">{n.age}</span>
              </div>
              <div className="mt-1.5 text-[13px] font-bold text-tc-ink">{n.title}</div>
              <div className="mt-0.5 text-[11.5px] text-tc-muted">{n.reason}</div>
              {n.action && (
                <Link
                  href={n.action.href}
                  className="mt-2.5 inline-flex h-8 items-center rounded-full border border-[rgba(15,23,32,0.14)] bg-white px-3.5 text-[12.5px] font-semibold text-tc-ink hover:bg-tc-sub"
                >
                  {n.action.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </TcCard>
  );
}

