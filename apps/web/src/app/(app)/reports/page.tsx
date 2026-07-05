import Link from "next/link";
import { Download } from "lucide-react";
import { getReportsData } from "@/lib/supabase/queries/reports";
import { formatMUR } from "@/lib/money";

const METHOD_COLOR: Record<string, string> = { card: "#2b8cff", cash: "#0da77c", juice: "#6a5cff", bank_transfer: "#f5a623" };
const METHOD_LABEL: Record<string, string> = { card: "Card", cash: "Cash", juice: "Juice", bank_transfer: "Bank transfer" };

const REPORTS = [
  { key: "collected", label: "Collected by method" },
  { key: "vat", label: "VAT report" },
  { key: "receivables", label: "Aged receivables" },
];
const SOON = ["Simple P&L", "Best-sellers", "Revenue by technician", "End-of-day cash-up"];

function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const report = REPORTS.some((x) => x.key === sp.r) ? sp.r! : "collected";
  const data = await getReportsData(sp.from, sp.to);
  const rangeLabel = sp.from || sp.to ? `${sp.from ?? "…"} → ${sp.to ?? "…"}` : "All time";

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
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
        <div className="mt-4 px-2.5 text-[10px] font-bold uppercase tracking-wider text-faint">Arriving Phase 3</div>
        <div className="mt-1.5 flex flex-col gap-1.5 px-2.5">
          {SOON.map((s) => (
            <span key={s} className="text-[12px] text-faint">{s}</span>
          ))}
        </div>
      </div>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-line bg-sub px-5 py-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Date</span>
          <Link href={`/reports${qs({ r: report })}`} className={`h-[30px] rounded-lg border px-3 text-[12px] font-semibold leading-[30px] ${!sp.from ? "border-link bg-[rgba(43,140,255,0.12)] text-link" : "border-line-2 bg-card text-muted"}`}>
            All time
          </Link>
          <Link href={`/reports${qs({ r: report, from: monthStart })}`} className={`h-[30px] rounded-lg border px-3 text-[12px] font-semibold leading-[30px] ${sp.from === monthStart ? "border-link bg-[rgba(43,140,255,0.12)] text-link" : "border-line-2 bg-card text-muted"}`}>
            This month
          </Link>
          <span className="num text-[11.5px] text-muted">{rangeLabel}</span>
          <div className="flex-1" />
          {report === "collected" && (
            <a href={`/api/reports/payments/csv${qs({ from: sp.from, to: sp.to })}`} className="flex h-8 items-center gap-1.5 rounded-lg border border-line-2 bg-card px-3 text-[12px] font-semibold text-body">
              <Download size={14} /> CSV
            </a>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {report === "collected" && (
            <div className="flex flex-col gap-4">
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
                <div className="grid grid-cols-[140px_110px_1fr_120px_130px] gap-3 border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
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
        </div>
      </div>
    </div>
  );
}
