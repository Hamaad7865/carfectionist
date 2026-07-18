import Link from "next/link";
import { Download } from "lucide-react";
import { getReportsData, getExtraReports, getCustomerStatement, getStatementCustomers, getDiscountsReport, getStatementOfAccounts, getCustomerAgedStatement } from "@/lib/supabase/queries/reports";
import { getDailySummary } from "@/lib/supabase/queries/daily-summary";
import { DailySummaryTable, parseSections, ALL_SECTIONS, type SectionKey } from "@/features/reports/DailySummaryTable";
import { muToday } from "@/lib/mu-date";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { StatementPicker } from "@/features/reports/StatementPicker";
import { StatementSendButton } from "@/features/reports/StatementSendButton";
import { formatMUR } from "@/lib/money";
import { muDate } from "@/lib/mu-date";
import { btn } from "@/components/ui/button";

const METHOD_COLOR: Record<string, string> = { card: "#2b8cff", cash: "#0da77c", juice: "#6a5cff", bank_transfer: "#f5a623" };
const METHOD_LABEL: Record<string, string> = { card: "Card", cash: "Cash", juice: "Juice", bank_transfer: "Bank transfer" };

// VAT chart series — brand blue + the app's amber ink. This exact pair passes
// the palette checks (lightness band, CVD ΔE ≈ 118, ≥3:1 on white); the lighter
// #f5a623 fails both, which is why the darker ink is used here.
const VAT_OUTPUT = "#2b8cff";
const VAT_INPUT = "#b07c14";
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis-tick money: "980", "12.5k", "1.2M" — full figures live in tooltips and the table. */
function rsCompact(cents: number): string {
  const r = cents / 100;
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (r >= 1_000) return `${(r / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(r));
}

const REPORTS = [
  { key: "daily-summary", label: "Daily summary" },
  { key: "collected", label: "Collected by method" },
  { key: "vat", label: "VAT report" },
  { key: "pnl", label: "Simple P&L" },
  { key: "bestsellers", label: "Best-sellers" },
  { key: "technician", label: "Revenue by technician" },
  { key: "discounts", label: "Discounts given" },
  { key: "receivables", label: "Aged receivables" },
  { key: "statement-list", label: "Statement of accounts" },
  { key: "statement", label: "Customer statement" },
  // End-of-day cash-up moved to the Point of Sale module (tills live with
  // their devices now); the /api/reports/cash/csv export remains.
];
const EXTRA = ["pnl", "bestsellers", "technician"];

function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; from?: string; to?: string; m?: string; c?: string; sec?: string }>;
}) {
  const sp = await searchParams;
  const report = REPORTS.some((x) => x.key === sp.r) ? sp.r! : "collected";
  const method = ["cash", "card", "juice", "bank_transfer"].includes(sp.m ?? "") ? sp.m : undefined;
  const data = await getReportsData(sp.from, sp.to, method);
  const extra = EXTRA.includes(report) ? await getExtraReports(sp.from, sp.to) : null;
  const discounts = report === "discounts" ? await getDiscountsReport(sp.from, sp.to) : null;
  const statement =
    report === "statement"
      ? {
          customers: await getStatementCustomers(),
          data: sp.c ? await getCustomerStatement(sp.c, sp.from, sp.to) : null,
          aged: sp.c ? await getCustomerAgedStatement(sp.c) : null,
        }
      : null;
  const statementList = report === "statement-list" ? await getStatementOfAccounts() : null;

  // Daily summary is a PERIOD report — "all time" is meaningless (and would build
  // a row per day since the studio opened), so it falls back to the current month.
  const dsFrom = sp.from ?? muToday().slice(0, 8) + "01";
  const dsTo = sp.to ?? muToday();
  const daily = report === "daily-summary" ? await getDailySummary(dsFrom, dsTo) : null;
  const dsSections = parseSections(sp.sec);
  const rangeLabel = sp.from || sp.to ? `${sp.from ?? "…"} → ${sp.to ?? "…"}` : "All time";

  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const monthStart = `${now.getFullYear()}-${mm}-01`;
  const monthEnd = `${now.getFullYear()}-${mm}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const methodMax = data.byMethod[0]?.cents ?? 1;

  return (
    <div className="flex h-full">
      {/* rail */}
      <div className="w-[236px] shrink-0 overflow-y-auto border-r border-line bg-sub p-3">
        <div className="px-2.5 pb-2.5 pt-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Reports</div>
        <div className="flex flex-col gap-[3px]">
          {REPORTS.map((x) => {
            const on = report === x.key;
            return (
              <Link
                key={x.key}
                href={`/reports${qs({ r: x.key, from: sp.from, to: sp.to })}`}
                className={`relative flex h-10 items-center rounded-[9px] px-3.5 text-[13px] font-semibold ${on ? "bg-[rgba(43,140,255,0.10)] text-link" : "text-[#3d4a59] hover:bg-[rgba(15,23,32,0.04)]"}`}
              >
                {on && <span className="grad-rail absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-[3px]" />}
                {x.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-4 rounded-[12px] border border-[rgba(43,140,255,0.14)] bg-[rgba(43,140,255,0.06)] p-3">
          <div className="mb-1 text-[11px] font-bold text-[#2f78de]">Cash vs revenue</div>
          <div className="text-[11px] leading-relaxed text-muted">
            Reports separate <b className="text-body">cash received</b> (the till) from <b className="text-body">revenue invoiced</b> (VAT &amp; P&amp;L).
          </div>
        </div>
      </div>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-line bg-sub px-5 py-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Date</span>
          <Link href={`/reports${qs({ r: report, m: method })}`} className={`h-[30px] rounded-lg border px-3 text-[12px] font-semibold leading-[30px] ${!sp.from && !sp.to ? "border-link bg-[rgba(43,140,255,0.12)] text-link" : "border-line-2 bg-card text-muted"}`}>
            All time
          </Link>
          <Link href={`/reports${qs({ r: report, from: monthStart, to: monthEnd, m: method })}`} className={`h-[30px] rounded-lg border px-3 text-[12px] font-semibold leading-[30px] ${sp.from === monthStart ? "border-link bg-[rgba(43,140,255,0.12)] text-link" : "border-line-2 bg-card text-muted"}`}>
            This month
          </Link>
          <div className="mx-1 h-6 w-px bg-line-2" />
          <DateRangeFilter label={false} />
          <div className="flex-1" />
          {report !== "statement" && report !== "statement-list" && (
            <a href={`/api/reports/${report}/csv${qs({ from: sp.from, to: sp.to, m: report === "collected" ? method : undefined })}`} className={btn("ghost", "sm")}>
              <Download size={14} /> CSV
            </a>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {report === "daily-summary" && daily && (
            <DailySummaryTable
              summary={daily}
              sections={dsSections}
              hrefFor={(next: SectionKey[]) =>
                `/reports${qs({
                  r: "daily-summary",
                  from: sp.from,
                  to: sp.to,
                  // all-on is the default, so it needs no param; none-on must be explicit
                  sec: next.length === ALL_SECTIONS.length ? undefined : next.length ? next.join(",") : "none",
                })}`
              }
              exportHref={`/api/reports/daily-summary/xlsx${qs({ from: dsFrom, to: dsTo, sec: sp.sec })}`}
            />
          )}

          {report === "collected" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Method</span>
                {[undefined, "cash", "card", "juice", "bank_transfer"].map((mkey) => {
                  const on = method === mkey;
                  return (
                    <Link
                      key={mkey ?? "all"}
                      href={`/reports${qs({ r: "collected", from: sp.from, to: sp.to, m: mkey })}`}
                      className={`inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12px] font-semibold ${on ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-muted hover:text-body"}`}
                    >
                      {mkey ? METHOD_LABEL[mkey] : "All"}
                    </Link>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="rounded-[15px] border border-[rgba(43,140,255,0.25)] p-5" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}>
                  <div className="text-[12px] font-semibold text-[#3d5978]">Cash received · {rangeLabel}</div>
                  <div className="num mt-2 text-[30px] font-extrabold text-[#0f2f5e]">{formatMUR(data.collectedCents)}</div>
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Revenue invoiced</div>
                  <div className="num mt-2 text-[24px] font-extrabold text-ink-strong">{formatMUR(data.invoicedCents)}</div>
                  <div className="mt-1 text-[11px] text-faint">Basis for VAT &amp; P&amp;L</div>
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Not yet collected</div>
                  <div className="num mt-2 text-[24px] font-extrabold text-amber-ink">{formatMUR(data.outstandingCents)}</div>
                  <div className="mt-1 text-[11px] text-faint">Moves to receivables</div>
                </div>
              </div>

              <div className="rounded-[15px] border border-line bg-card p-5">
                <div className="mb-4 font-display text-[14px] font-bold text-ink-strong">By method</div>
                {data.byMethod.length === 0 ? (
                  <div className="py-4 text-[12.5px] text-faint">No payments in range.</div>
                ) : (
                  <div className="flex flex-col gap-3.5">
                    {data.byMethod.map((m) => (
                      <div key={m.method}>
                        <div className="flex items-center gap-2.5">
                          <span className="size-[11px] rounded-[3px]" style={{ background: METHOD_COLOR[m.method] ?? "#8c96a1" }} />
                          <span className="flex-1 text-[13px] font-semibold text-body">{METHOD_LABEL[m.method] ?? m.method}</span>
                          <span className="num text-[13px] font-bold text-ink">{formatMUR(m.cents)}</span>
                        </div>
                        <div className="mt-1.5 h-[7px] overflow-hidden rounded-[4px] bg-[rgba(15,23,32,0.06)]">
                          <div className="h-full rounded-[4px]" style={{ width: `${Math.round((m.cents / methodMax) * 100)}%`, background: METHOD_COLOR[m.method] ?? "#8c96a1" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-[14px] border border-line bg-card">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <span className="font-display text-[14px] font-bold text-ink-strong">Payments received</span>
                  <span className="rounded-lg bg-[rgba(43,140,255,0.1)] px-2.5 py-1 text-[11px] font-bold text-link">{data.payments.length} payments</span>
                </div>
                <div className="grid grid-cols-[140px_110px_1fr_120px_130px] gap-3 border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                  <span>Date</span><span>Document</span><span>Customer</span><span>Method</span><span className="text-right">Amount</span>
                </div>
                {data.payments.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[13px] text-faint">No payments in this range.</div>
                ) : (
                  data.payments.map((p) => (
                    <div key={p.id} className="grid grid-cols-[140px_110px_1fr_120px_130px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
                      <span className="num text-muted">{p.date}</span>
                      <span className="num font-bold text-link">{p.number ?? "—"}</span>
                      <span className="text-body">{p.customer ?? "—"}</span>
                      <span className="text-muted">{METHOD_LABEL[p.method] ?? p.method}</span>
                      <span className="num text-right font-bold text-ink">{formatMUR(p.amountCents)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {report === "vat" && (
            <div className="max-w-2xl">
              <div className="grid grid-cols-3 gap-3.5">
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Output VAT</div>
                  <div className="num mt-2 text-[22px] font-extrabold text-ink-strong">{formatMUR(data.vat.outputCents)}</div>
                  <div className="mt-1 text-[11px] text-faint">On issued invoices</div>
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Input VAT</div>
                  <div className="num mt-2 text-[22px] font-extrabold text-ink-strong">{formatMUR(data.vat.inputCents)}</div>
                  <div className="mt-1 text-[11px] text-faint">On expenses</div>
                </div>
                <div className="rounded-[15px] border border-[rgba(43,140,255,0.25)] p-5" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}>
                  <div className="text-[12px] font-semibold text-[#3d5978]">Net VAT payable</div>
                  <div className="num mt-2 text-[22px] font-extrabold text-[#0f2f5e]">{formatMUR(data.vat.netCents)}</div>
                  <div className="mt-1 text-[11px] text-[#3d5978]">Output − Input</div>
                </div>
              </div>
              <p className="mt-4 text-[12.5px] text-muted">Output VAT (15% on issued invoices) minus input VAT (recorded on expenses) gives the net VAT payable to the MRA for the period.</p>

              {/* ── VAT by month — the figure each MRA return asks for ── */}
              <div className="mt-4 rounded-[15px] border border-line bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-[14px] font-bold text-ink-strong">VAT by month</span>
                  <span className="flex items-center gap-4 text-[11.5px] font-semibold text-body">
                    <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: VAT_OUTPUT }} /> Output</span>
                    <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: VAT_INPUT }} /> Input</span>
                  </span>
                </div>

                {data.vatMonthly.length === 0 ? (
                  <div className="mt-4 rounded-[12px] border border-dashed border-line-2 px-4 py-8 text-center text-[12.5px] text-faint">No VAT activity in this range.</div>
                ) : (
                  (() => {
                    const H = 150;
                    const maxCents = Math.max(1, ...data.vatMonthly.map((mo) => Math.max(mo.outputCents, mo.inputCents)));
                    return (
                      <div className="mt-4 flex gap-3">
                        {/* y-axis — compact rupee ticks */}
                        <div className="flex flex-col justify-between text-right" style={{ height: H + 18 }}>
                          {[1, 2 / 3, 1 / 3, 0].map((f) => (
                            <span key={f} className="num text-[10px] leading-none text-faint">{rsCompact(maxCents * f)}</span>
                          ))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="relative" style={{ height: H }}>
                            {/* recessive gridlines at the tick fractions */}
                            {[0, 1 / 3, 2 / 3].map((f) => (
                              <div key={f} className="absolute inset-x-0 border-t border-line" style={{ top: H * f }} />
                            ))}
                            <div className="absolute inset-x-0 bottom-0 border-t border-line-2" />
                            <div className="flex h-full items-end gap-1 overflow-visible">
                              {data.vatMonthly.map((mo) => (
                                <div key={mo.month} className="group relative flex h-full max-w-[60px] flex-1 items-end justify-center gap-[2px]">
                                  {/* hover tooltip — month, all three figures */}
                                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 flex-col whitespace-nowrap rounded-[9px] bg-[#0f1720] px-3 py-2 text-[11px] text-white shadow-lg group-hover:flex">
                                    <span className="font-bold">{mo.label}</span>
                                    <span className="num mt-1">Output {formatMUR(mo.outputCents)}</span>
                                    <span className="num">Input {formatMUR(mo.inputCents)}</span>
                                    <span className="num mt-0.5 font-bold">{mo.netCents >= 0 ? `Pay ${formatMUR(mo.netCents)}` : `Credit ${formatMUR(-mo.netCents)}`}</span>
                                  </div>
                                  <div className="absolute inset-0 rounded-[6px] group-hover:bg-[rgba(43,140,255,0.05)]" />
                                  <div className="w-[11px] rounded-t-[3px]" style={{ height: Math.round((Math.max(0, mo.outputCents) / maxCents) * H), background: VAT_OUTPUT }} />
                                  <div className="w-[11px] rounded-t-[3px]" style={{ height: Math.round((Math.max(0, mo.inputCents) / maxCents) * H), background: VAT_INPUT }} />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="mt-1 flex gap-1">
                            {data.vatMonthly.map((mo) => (
                              <div key={mo.month} className="num max-w-[60px] flex-1 text-center text-[10px] text-faint">
                                {mo.month.slice(5) === "01" || mo.month === data.vatMonthly[0].month ? `${MONTH_SHORT[Number(mo.month.slice(5)) - 1]} ${mo.month.slice(2, 4)}` : MONTH_SHORT[Number(mo.month.slice(5)) - 1]}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}
                {data.vatMonthlyTruncated && <p className="mt-2 text-[11px] text-faint">Showing the last 12 months of the range — narrow the dates to see earlier months.</p>}
              </div>

              {/* Monthly breakdown table — the accessible twin of the chart */}
              {data.vatMonthly.length > 0 && (
                <div className="mt-4 overflow-hidden rounded-[15px] border border-line bg-card">
                  <div className="grid grid-cols-[1fr_110px_110px_130px] gap-3 border-b border-line bg-band px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-th">
                    <span>Month</span><span className="text-right">Output VAT</span><span className="text-right">Input VAT</span><span className="text-right">Net payable</span>
                  </div>
                  {[...data.vatMonthly].reverse().map((mo) => {
                    const current = mo.month === muToday().slice(0, 7);
                    return (
                      <div key={mo.month} className={`grid grid-cols-[1fr_110px_110px_130px] items-center gap-3 border-b border-line px-5 py-2.5 text-[12.5px] last:border-b-0 ${current ? "bg-[rgba(43,140,255,0.05)]" : ""}`}>
                        <span className="font-semibold text-body">
                          {mo.label}
                          {current && <span className="ml-2 rounded-[5px] bg-[rgba(43,140,255,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-link">Current</span>}
                        </span>
                        <span className="num text-right text-muted">{formatMUR(mo.outputCents)}</span>
                        <span className="num text-right text-muted">{formatMUR(mo.inputCents)}</span>
                        <span className={`num text-right font-bold ${mo.netCents < 0 ? "text-mint" : "text-ink"}`}>{formatMUR(mo.netCents)}</span>
                      </div>
                    );
                  })}
                  <div className="px-5 py-3 text-[11.5px] text-muted">
                    A month&apos;s VAT return is due to the MRA by the end of the following month. A negative net is a credit — input VAT exceeded output for that month.
                  </div>
                </div>
              )}
            </div>
          )}

          {report === "receivables" && (
            <div className="max-w-2xl overflow-hidden rounded-[15px] border border-line bg-card">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <span className="font-display text-[14px] font-bold text-ink-strong">Aged receivables</span>
                <span className="num text-[14px] font-extrabold text-amber-ink">{formatMUR(data.outstandingCents)}</span>
              </div>
              {data.aged.map((b) => {
                const pct = data.outstandingCents > 0 ? Math.round((b.cents / data.outstandingCents) * 100) : 0;
                return (
                  <div key={b.label} className="border-b border-line px-5 py-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-body">{b.label}</span>
                      <span className="num text-[13px] font-bold text-ink">{formatMUR(b.cents)}</span>
                    </div>
                    <div className="mt-1.5 h-[7px] overflow-hidden rounded-[4px] bg-[rgba(15,23,32,0.06)]">
                      <div className="h-full rounded-[4px]" style={{ width: `${pct}%`, background: b.label.startsWith("90") ? "#d63b50" : "#f5a623" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {report === "pnl" && extra && (
            <div className="max-w-xl">
              <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                {[
                  { label: "Revenue invoiced", note: "VAT-exclusive", cents: extra.pnl.revenueCents, tone: "text-ink-strong" },
                  { label: "Cost of goods sold", note: "Stock consumed on sales & jobs", cents: -extra.pnl.cogsCents, tone: "text-body" },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between border-b border-line px-5 py-3.5">
                    <div>
                      <div className="text-[13px] font-semibold text-body">{r.label}</div>
                      <div className="text-[11px] text-faint">{r.note}</div>
                    </div>
                    <span className={`num text-[14px] font-bold ${r.tone}`}>{formatMUR(r.cents)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-b border-line bg-sub px-5 py-3">
                  <span className="text-[13px] font-bold text-ink">Gross profit</span>
                  <span className="num text-[14px] font-extrabold text-mint">{formatMUR(extra.pnl.grossCents)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <div>
                    <div className="text-[13px] font-semibold text-body">Operating expenses</div>
                    <div className="text-[11px] text-faint">VAT-exclusive</div>
                  </div>
                  <span className="num text-[14px] font-bold text-body">{formatMUR(-extra.pnl.expensesCents)}</span>
                </div>
                <div className="flex items-center justify-between px-5 py-4" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}>
                  <span className="text-[14px] font-extrabold text-[#0f2f5e]">Net profit</span>
                  <span className="num text-[18px] font-extrabold" style={{ color: extra.pnl.netCents >= 0 ? "#0f2f5e" : "#d63b50" }}>{formatMUR(extra.pnl.netCents)}</span>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-muted">Revenue is invoiced value (excl. VAT). COGS is the cost of stock that left on sales and job consumption. Net profit = revenue − COGS − operating expenses.</p>
            </div>
          )}

          {report === "bestsellers" && extra && (
            <div className="max-w-2xl overflow-hidden rounded-[15px] border border-line bg-card">
              <div className="grid grid-cols-[36px_1fr_90px_130px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                <span>#</span><span>Item</span><span className="text-right">Qty</span><span className="text-right">Revenue</span>
              </div>
              {extra.bestSellers.length === 0 ? (
                <div className="px-5 py-14 text-center text-[13px] text-faint">No sales in this range yet.</div>
              ) : (
                extra.bestSellers.map((b, i) => {
                  const max = extra.bestSellers[0].revenueCents || 1;
                  return (
                    <div key={b.name} className="grid grid-cols-[36px_1fr_90px_130px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
                      <span className="num font-bold text-faint">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-body">{b.name}</div>
                        <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-[rgba(15,23,32,0.06)]">
                          <div className="grad-brand h-full rounded-full" style={{ width: `${Math.round((b.revenueCents / max) * 100)}%` }} />
                        </div>
                      </div>
                      <span className="num text-right text-muted">{Number.isInteger(b.qty) ? b.qty : b.qty.toFixed(2)}</span>
                      <span className="num text-right font-bold text-ink">{formatMUR(b.revenueCents)}</span>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {report === "technician" && extra && (
            <div className="max-w-2xl overflow-hidden rounded-[15px] border border-line bg-card">
              <div className="grid grid-cols-[1fr_80px_140px] gap-3 border-b border-line bg-band px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                <span>Technician</span><span className="text-right">Jobs</span><span className="text-right">Revenue</span>
              </div>
              {extra.byTechnician.length === 0 ? (
                <div className="px-5 py-14 text-center text-[13px] text-faint">No invoiced revenue in this range yet.</div>
              ) : (
                extra.byTechnician.map((t) => (
                  <div key={t.name} className="grid grid-cols-[1fr_80px_140px] items-center gap-3 border-b border-line px-5 py-3.5 text-[13px]">
                    <span className="font-semibold text-body">{t.name}</span>
                    <span className="num text-right text-muted">{t.jobs || "—"}</span>
                    <span className="num text-right font-bold text-ink">{formatMUR(t.revenueCents)}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {report === "discounts" && discounts && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="rounded-[15px] border border-[rgba(245,166,35,0.3)] p-5" style={{ background: "linear-gradient(150deg,#fff5e4,#ffedd0)" }}>
                  <div className="text-[12px] font-semibold text-[#8a6410]">Discount given · {rangeLabel}</div>
                  <div className="num mt-2 text-[30px] font-extrabold text-[#7a4f00]">{formatMUR(discounts.totalDiscountCents)}</div>
                  <div className="mt-1 text-[11px] text-[#8a6410]">Revenue foregone (excl. VAT)</div>
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Whole-sale vs line</div>
                  <div className="num mt-2 text-[17px] font-extrabold text-ink-strong">{formatMUR(discounts.orderDiscountCents)} <span className="text-[11.5px] font-semibold text-muted">basket</span></div>
                  <div className="num mt-0.5 text-[17px] font-extrabold text-ink-strong">{formatMUR(discounts.lineDiscountCents)} <span className="text-[11.5px] font-semibold text-muted">line</span></div>
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Discounted invoices</div>
                  <div className="num mt-2 text-[24px] font-extrabold text-ink-strong">{discounts.discountedCount} <span className="text-[13px] font-semibold text-muted">of {discounts.invoiceCount}</span></div>
                  <div className="mt-1 text-[11px] text-faint">{discounts.grossExclCents > 0 ? ((discounts.totalDiscountCents / discounts.grossExclCents) * 100).toFixed(1) : "0.0"}% of gross ex-VAT</div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[14px] border border-line bg-card">
                <div className="grid grid-cols-[104px_96px_1fr_120px_110px_62px] gap-3 border-b border-line bg-band px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                  <span>Date</span><span>Invoice</span><span>Customer</span><span className="text-right">Gross ex-VAT</span><span className="text-right">Discount</span><span className="text-right">%</span>
                </div>
                {discounts.rows.length === 0 ? (
                  <div className="px-5 py-14 text-center text-[13px] text-faint">No discounts given in this range.</div>
                ) : (
                  discounts.rows.map((d) => (
                    <div key={d.id} className="grid grid-cols-[104px_96px_1fr_120px_110px_62px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
                      <span className="num text-muted">{d.date ?? "—"}</span>
                      <Link href={`/sales/${d.id}`} className="num font-bold text-link hover:underline">{d.number ?? "—"}</Link>
                      <span className="truncate text-body">{d.customer ?? "—"}</span>
                      <span className="num text-right text-muted">{formatMUR(d.grossExclCents)}</span>
                      <span className="num text-right font-bold text-amber-ink">−{formatMUR(d.totalDiscountCents)}</span>
                      <span className="num text-right text-muted">{d.discountPct.toFixed(1)}%</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {report === "statement-list" && statementList && (
            <div className="flex flex-col gap-4">
              <div className="rounded-[15px] border border-line bg-card p-5">
                <div className="font-display text-[15px] font-bold text-ink-strong">Statement of accounts</div>
                <div className="mt-1 text-[12.5px] text-muted">Every customer who owes the shop, as at {muDate(new Date().toISOString())}. Carried-forward figures are the balances brought over from Cashmag.</div>
              </div>

              <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                <div className="grid grid-cols-[1fr_130px_130px_150px_120px] gap-3 border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                  <span>Customer</span><span className="text-right">Live</span><span className="text-right">Carried</span><span className="text-right">Balance owed</span><span className="text-right">Statement</span>
                </div>
                {statementList.length === 0 ? (
                  <div className="px-5 py-12 text-center text-[13px] text-faint">No customer owes anything right now.</div>
                ) : (
                  statementList.map((c) => (
                    <div key={c.id} className="grid grid-cols-[1fr_130px_130px_150px_120px] items-center gap-3 border-b border-line px-5 py-2.5 text-[12.5px]">
                      <Link href={`/reports${qs({ r: "statement", c: c.id })}`} className="font-semibold text-link hover:underline">{c.name}</Link>
                      <span className="num text-right text-muted">{c.liveCents ? formatMUR(c.liveCents) : "—"}</span>
                      <span className="num text-right text-muted">{c.carriedCents ? formatMUR(c.carriedCents) : "—"}</span>
                      <span className="num text-right font-bold text-ink">{formatMUR(c.balanceCents)}</span>
                      <span className="flex items-center justify-end gap-3">
                        <a href={`/api/reports/statement/${c.id}/pdf`} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-link hover:underline">PDF</a>
                        <StatementSendButton customerId={c.id} customerName={c.name} email={c.email} />
                      </span>
                    </div>
                  ))
                )}
                <div className="grid grid-cols-[1fr_130px_130px_150px_120px] items-center gap-3 bg-sub px-5 py-3 text-[13px]">
                  <span className="font-bold text-ink">{statementList.length} customer{statementList.length === 1 ? "" : "s"}</span>
                  <span /><span />
                  <span className="num text-right font-extrabold text-brand">{formatMUR(statementList.reduce((s, c) => s + c.balanceCents, 0))}</span>
                  <span />
                </div>
              </div>
            </div>
          )}

          {report === "statement" && statement && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Customer</span>
                  <StatementPicker customers={statement.customers} current={sp.c} from={sp.from} to={sp.to} />
                </div>
                {sp.c && statement.aged && (
                  <div className="flex items-center gap-3">
                    <a href={`/api/reports/statement/${sp.c}/pdf`} target="_blank" rel="noreferrer" className={btn("ghost", "sm")}>
                      <Download size={14} /> PDF
                    </a>
                    <StatementSendButton customerId={sp.c} customerName={statement.aged.customerName} email={statement.aged.customerEmail} />
                  </div>
                )}
              </div>

              {statement.aged && statement.aged.soldeCents !== 0 && (
                <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                  <div className="border-b border-line px-5 py-3.5 font-display text-[14px] font-bold text-ink-strong">Balance — aged</div>
                  <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                      <div className="grid border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th" style={{ gridTemplateColumns: `130px repeat(${statement.aged.buckets.length}, 1fr)` }}>
                        <span>Solde</span>
                        {statement.aged.buckets.map((b) => <span key={b.key} className="text-right">{b.label}</span>)}
                      </div>
                      <div className="grid items-center px-5 py-3 text-[12.5px]" style={{ gridTemplateColumns: `130px repeat(${statement.aged.buckets.length}, 1fr)` }}>
                        <span className="num font-extrabold text-brand">{formatMUR(statement.aged.soldeCents)}</span>
                        {statement.aged.buckets.map((b) => <span key={b.key} className="num text-right text-body">{b.cents ? formatMUR(b.cents) : "—"}</span>)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {statement.aged && (statement.aged.invoices.length > 0 || statement.aged.carriedCents !== 0) && (
                <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                  <div className="border-b border-line px-5 py-3.5 font-display text-[14px] font-bold text-ink-strong">Credit invoices</div>
                  <div className="grid grid-cols-[110px_1fr_130px_130px] gap-3 border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                    <span>Date</span><span>Detail</span><span className="text-right">Debit</span><span className="text-right">Credit</span>
                  </div>
                  {statement.aged.carriedCents !== 0 && (
                    <div className="grid grid-cols-[110px_1fr_130px_130px] items-center gap-3 border-b border-line px-5 py-2.5 text-[12.5px] text-muted">
                      <span className="num">Avant</span>
                      <span className="italic">Carried forward from Cashmag</span>
                      <span className="num text-right text-body">{statement.aged.carriedCents > 0 ? formatMUR(statement.aged.carriedCents) : "—"}</span>
                      <span className="num text-right text-mint">{statement.aged.carriedCents < 0 ? formatMUR(-statement.aged.carriedCents) : "—"}</span>
                    </div>
                  )}
                  {statement.aged.invoices.map((inv, i) => (
                    <div key={i} className="grid grid-cols-[110px_1fr_130px_130px] items-start gap-3 border-b border-line px-5 py-2.5 text-[12.5px]">
                      <span className="num text-muted">{inv.date ? muDate(`${inv.date}T00:00:00+04:00`) : "—"}</span>
                      <span className="text-body">
                        {inv.number && <span className="num font-semibold text-link">{inv.number}</span>}
                        <span className="mt-0.5 block text-[11.5px] text-muted">
                          {inv.lines.length ? inv.lines.map((l) => `${l.qty} × ${l.title}${l.discountPct ? ` (−${l.discountPct}%)` : ""}`).join(" · ") : "—"}
                        </span>
                      </span>
                      <span className="num text-right text-body">{formatMUR(inv.debitCents)}</span>
                      <span className="num text-right text-mint">{inv.creditCents ? formatMUR(inv.creditCents) : "—"}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-[110px_1fr_130px_130px] items-center gap-3 bg-sub px-5 py-3 text-[13px]">
                    <span /><span className="font-bold text-ink">Balance owed</span>
                    <span className="num text-right font-extrabold text-brand">{formatMUR(statement.aged.soldeCents)}</span>
                    <span />
                  </div>
                </div>
              )}

              {!statement.data && !statement.aged ? (
                <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">Pick a customer to see their statement of account.</div>
              ) : statement.data && statement.data.lines.length > 0 ? (
                // Live ledger — only when there is real activity in the system, so it
                // never contradicts the aged view above with a "Balance due Rs 0.00".
                <>
                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                    <div className="rounded-[15px] border border-line bg-card p-5">
                      <div className="text-[12px] font-semibold text-muted">Invoiced · {rangeLabel}</div>
                      <div className="num mt-2 text-[24px] font-extrabold text-ink-strong">{formatMUR(statement.data.invoicedCents)}</div>
                    </div>
                    <div className="rounded-[15px] border border-line bg-card p-5">
                      <div className="text-[12px] font-semibold text-muted">Paid + credited</div>
                      <div className="num mt-2 text-[24px] font-extrabold text-mint">{formatMUR(statement.data.settledCents)}</div>
                    </div>
                    <div className="rounded-[15px] border border-[rgba(43,140,255,0.25)] p-5" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}>
                      <div className="text-[12px] font-semibold text-[#3d5978]">Balance due</div>
                      <div className="num mt-2 text-[24px] font-extrabold" style={{ color: statement.data.closingCents > 0 ? "#0f2f5e" : "#0da77c" }}>{formatMUR(statement.data.closingCents)}</div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                    <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                      <span className="font-display text-[14px] font-bold text-ink-strong">{statement.data.customerName}</span>
                      <span className="text-[12px] text-muted">{rangeLabel}</span>
                    </div>
                    <div className="grid grid-cols-[110px_1fr_120px_120px_130px] gap-3 border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
                      <span>Date</span><span>Detail</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-right">Balance</span>
                    </div>
                    {sp.from && (
                      <div className="grid grid-cols-[110px_1fr_120px_120px_130px] items-center gap-3 border-b border-line px-5 py-2.5 text-[12.5px] text-muted">
                        <span /><span className="italic">Opening balance</span><span /><span /><span className="num text-right font-bold text-ink">{formatMUR(statement.data.openingCents)}</span>
                      </div>
                    )}
                    {statement.data.lines.length === 0 ? (
                      <div className="px-5 py-12 text-center text-[13px] text-faint">No transactions in this range.</div>
                    ) : (
                      statement.data.lines.map((l, i) => (
                        <div key={i} className="grid grid-cols-[110px_1fr_120px_120px_130px] items-center gap-3 border-b border-line px-5 py-2.5 text-[12.5px]">
                          <span className="num text-muted">{l.date}</span>
                          <span className="text-body">{l.detail}{l.ref ? <span className="num ml-2 text-faint">{l.ref}</span> : null}</span>
                          <span className="num text-right text-body">{l.debitCents ? formatMUR(l.debitCents) : "—"}</span>
                          <span className="num text-right text-mint">{l.creditCents ? formatMUR(l.creditCents) : "—"}</span>
                          <span className="num text-right font-bold text-ink">{formatMUR(l.balanceCents)}</span>
                        </div>
                      ))
                    )}
                    <div className="grid grid-cols-[110px_1fr_120px_120px_130px] items-center gap-3 bg-sub px-5 py-3 text-[13px]">
                      <span /><span className="font-bold text-ink">Balance due</span><span /><span /><span className="num text-right font-extrabold text-brand">{formatMUR(statement.data.closingCents)}</span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
