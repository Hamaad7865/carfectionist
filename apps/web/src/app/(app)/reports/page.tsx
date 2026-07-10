import Link from "next/link";
import { Download } from "lucide-react";
import { getReportsData, getExtraReports, getCustomerStatement, getStatementCustomers, getDiscountsReport } from "@/lib/supabase/queries/reports";
import { getCashSessions } from "@/lib/supabase/queries/cash";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { CashSessions } from "@/features/cash/CashSessions";
import { StatementPicker } from "@/features/reports/StatementPicker";
import { formatMUR } from "@/lib/money";

const METHOD_COLOR: Record<string, string> = { card: "#2b8cff", cash: "#0da77c", juice: "#6a5cff", bank_transfer: "#f5a623" };
const METHOD_LABEL: Record<string, string> = { card: "Card", cash: "Cash", juice: "Juice", bank_transfer: "Bank transfer" };

const REPORTS = [
  { key: "collected", label: "Collected by method" },
  { key: "vat", label: "VAT report" },
  { key: "pnl", label: "Simple P&L" },
  { key: "bestsellers", label: "Best-sellers" },
  { key: "technician", label: "Revenue by technician" },
  { key: "discounts", label: "Discounts given" },
  { key: "receivables", label: "Aged receivables" },
  { key: "statement", label: "Customer statement" },
  { key: "cash", label: "End-of-day cash-up" },
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
  searchParams: Promise<{ r?: string; from?: string; to?: string; m?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const report = REPORTS.some((x) => x.key === sp.r) ? sp.r! : "collected";
  const method = ["cash", "card", "juice", "bank_transfer"].includes(sp.m ?? "") ? sp.m : undefined;
  const data = await getReportsData(sp.from, sp.to, method);
  const cash = report === "cash" ? await getCashSessions() : null;
  const extra = EXTRA.includes(report) ? await getExtraReports(sp.from, sp.to) : null;
  const discounts = report === "discounts" ? await getDiscountsReport(sp.from, sp.to) : null;
  const statement =
    report === "statement"
      ? { customers: await getStatementCustomers(), data: sp.c ? await getCustomerStatement(sp.c, sp.from, sp.to) : null }
      : null;
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
          {report !== "statement" && (
            <a href={`/api/reports/${report}/csv${qs({ from: sp.from, to: sp.to, m: report === "collected" ? method : undefined })}`} className="flex h-8 items-center gap-1.5 rounded-lg border border-line-2 bg-card px-3 text-[12px] font-semibold text-body hover:border-brand">
              <Download size={14} /> CSV
            </a>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
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
            <div className="max-w-xl">
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

          {report === "cash" && cash && <CashSessions open={cash.open} recent={cash.recent} />}

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

          {report === "statement" && statement && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Customer</span>
                <StatementPicker customers={statement.customers} current={sp.c} from={sp.from} to={sp.to} />
              </div>

              {!statement.data ? (
                <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">Pick a customer to see their statement of account.</div>
              ) : (
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
