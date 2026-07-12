import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Power, UserRound, Download, Wallet, CalendarCheck, BadgePercent,
  ReceiptText, FileDown, CircleDot, Coins, Ban, Banknote, Monitor, TabletSmartphone,
} from "lucide-react";
import { getDeviceDashboard } from "@/lib/supabase/queries/pos-devices";
import { DeviceSettings } from "@/features/pos/DeviceSettings";
import { CashOutButton } from "@/features/pos/CashOutButton";
import { RefDatePicker } from "@/features/pos/RefDatePicker";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { formatMUR } from "@/lib/money";
import { muDateTime, muToday } from "@/lib/mu-date";

const TABS = [
  { key: "general", label: "General" },
  { key: "settings", label: "Settings" },
  { key: "cashflow", label: "Cash flow" },
  { key: "trace", label: "Traceability" },
] as const;

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", juice: "Juice", bank_transfer: "Bank transfer" };

// Cashmag-style round icons per traceability event kind.
const KIND_ICON: Record<string, typeof CircleDot> = {
  terminal_started: Power,
  version: Download,
  operator: UserRound,
  till_open: Wallet,
  till_close: CalendarCheck,
  payment: Coins,
  discount: BadgePercent,
  receipt: ReceiptText,
  export: FileDown,
  period: CalendarCheck,
  device_state: Ban,
  cash_out: Banknote,
};

export default async function DeviceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<{ tab?: string; ref?: string; from?: string; to?: string }>;
}) {
  const { deviceId } = await params;
  const sp = await searchParams;
  const code = decodeURIComponent(deviceId);
  const data = await getDeviceDashboard(code, { ref: sp.ref, from: sp.from, to: sp.to });
  if (!data) notFound();

  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "general";
  const { device, sessions, trace, todayCents, cashflow } = data;
  const Icon = device.isBackOffice ? Monitor : TabletSmartphone;
  const todayTotal = todayCents.reduce((s, m) => s + m.cents, 0);
  // Struck rows don't count: totals are NET of cancelled pairs (a reversed
  // inflow and its in-view mirror), per the owner — the header answers "what
  // did this till actually take/move", not "how many rows are printed".
  const inflowTotal = cashflow.inflows.reduce((s, m) => s + (m.wasReversed ? 0 : m.amountCents), 0);
  const outflowTotal = cashflow.outflows.reduce((s, m) => s + (m.cancelled ? 0 : m.amountCents), 0);

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        {/* header */}
        <Link href="/point-of-sale" className="text-[13px] font-semibold text-muted hover:text-body">← Point of Sale</Link>
        <div className="mt-2 flex items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-[13px] border border-[rgba(43,140,255,0.25)] bg-[rgba(43,140,255,0.08)] text-link">
            <Icon size={22} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate font-display text-[20px] font-extrabold text-ink-strong">{device.name}</h2>
              {!device.isBackOffice && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${device.online ? "bg-[rgba(13,167,124,0.12)] text-mint" : "bg-[rgba(15,23,32,0.06)] text-faint"}`}>
                  <span className={`size-1.5 rounded-full ${device.online ? "bg-mint" : "bg-[#c9d2dc]"}`} />
                  {device.online ? "Online" : "Offline"}
                </span>
              )}
              {!device.isActive && <span className="rounded-[5px] bg-[rgba(15,23,32,0.08)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-faint">Inactive</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-muted">
              {device.model && <span>{device.model}</span>}
              <span className="num text-faint">#{device.code}</span>
              {device.appVersion && <span className="num">v{device.appVersion}</span>}
            </div>
          </div>
        </div>

        {/* tabs */}
        <div className="mt-5 flex gap-1.5 overflow-x-auto border-b border-line pb-px">
          {TABS.map((t) => {
            const on = tab === t.key;
            // Cash Flow AND Traceability are date-picker-driven — seed today so
            // the pickers arrive filled (Cashmag defaults to today–today).
            const today = muToday();
            const href =
              t.key === "cashflow"
                ? `/point-of-sale/${encodeURIComponent(code)}?tab=cashflow&ref=${today}&from=${today}&to=${today}`
                : t.key === "trace"
                  ? `/point-of-sale/${encodeURIComponent(code)}?tab=trace&from=${today}&to=${today}`
                  : `/point-of-sale/${encodeURIComponent(code)}?tab=${t.key}`;
            return (
              <Link
                key={t.key}
                href={href}
                className={`whitespace-nowrap rounded-t-[10px] border-b-2 px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-[0.08em] ${
                  on ? "border-brand bg-[rgba(43,140,255,0.06)] text-link" : "border-transparent text-muted hover:text-body"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-5">
          {/* ── GENERAL ── */}
          {tab === "general" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div className="rounded-[15px] border border-[rgba(43,140,255,0.25)] p-5" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}>
                  <div className="text-[12px] font-semibold text-[#3d5978]">Taken today on this device</div>
                  <div className="num mt-2 text-[26px] font-extrabold text-[#0f2f5e]">{formatMUR(todayTotal)}</div>
                  <div className="mt-1 text-[11px] text-[#3d5978]">{todayCents.map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${formatMUR(m.cents)}`).join(" · ") || "No payments yet"}</div>
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Till</div>
                  {device.till ? (
                    <>
                      <div className="num mt-2 text-[20px] font-extrabold text-ink-strong">{formatMUR(device.till.expectedCents)}</div>
                      <div className="mt-1 text-[11px] text-faint">Expected in drawer · open since {muDateTime(device.till.openedAt).slice(11)}</div>
                    </>
                  ) : (
                    <>
                      <div className="mt-2 text-[20px] font-extrabold text-faint">Closed</div>
                      <div className="mt-1 text-[11px] text-faint">{device.isBackOffice ? "Open it from the module page" : "Opens from the tablet"}</div>
                    </>
                  )}
                </div>
                <div className="rounded-[15px] border border-line bg-card p-5">
                  <div className="text-[12px] font-semibold text-muted">Last activity</div>
                  <div className="num mt-2 text-[15px] font-bold text-ink">{trace[0]?.atLabel ?? "—"}</div>
                  <div className="mt-1 truncate text-[11px] text-faint">{trace[0] ? `${trace[0].title}${trace[0].detail ? ` — ${trace[0].detail}` : ""}` : "No events recorded yet"}</div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[15px] border border-line bg-card">
                <div className="border-b border-line px-5 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Latest sessions</div>
                {sessions.length === 0 ? (
                  <div className="px-5 py-10 text-center text-[12.5px] text-faint">This device hasn't opened a till yet.</div>
                ) : (
                  sessions.slice(0, 6).map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-[12.5px] last:border-b-0">
                      <span className={`size-2 rounded-full ${s.status === "open" ? "bg-mint" : "bg-[#c9d2dc]"}`} />
                      <span className="num text-muted">{muDateTime(s.openedAt)}</span>
                      <span className="text-body">{s.openedByName ?? "—"}</span>
                      <span className="num ml-auto font-semibold text-ink">{formatMUR(s.status === "open" ? s.expectedCents : (s.countedCents ?? 0))}</span>
                      {s.status === "closed" && s.varianceCents !== 0 && (
                        <span className={`num text-[11.5px] font-bold ${(s.varianceCents ?? 0) < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(s.varianceCents ?? 0)}</span>
                      )}
                      {s.status === "open" && <span className="rounded-[5px] bg-[rgba(13,167,124,0.12)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-mint">Open</span>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── SETTINGS ── */}
          {tab === "settings" && <DeviceSettings device={device} />}

          {/* ── CASH FLOW — everything driven by the date pickers (Cashmag spec) ── */}
          {tab === "cashflow" && (
            <div className="flex flex-col gap-4">
              {/* History: the closure snapshot saved at each till close */}
              <div className="rounded-[15px] border border-line bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-[15px] font-bold text-ink-strong">History</div>
                    <p className="mt-0.5 text-[12px] text-muted">Cash flow information is saved at each till closure.</p>
                  </div>
                  <RefDatePicker value={cashflow.refDate} />
                </div>

                {cashflow.closures.length === 0 ? (
                  <div className="mt-4 rounded-[12px] border border-dashed border-line-2 px-4 py-8 text-center text-[12.5px] text-faint">
                    No till closure on this date.
                  </div>
                ) : (
                  cashflow.closures.map((s) => (
                    <div key={s.id} className="mt-4 border-t border-line pt-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                        <span className="num font-bold text-ink">{muDateTime(s.closedAt!)}</span>
                        {s.closedByName && <span className="text-muted">closed by {s.closedByName}</span>}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-[13px] bg-sub p-4"><div className="text-[11px] font-semibold text-muted">Opening float</div><div className="num mt-1.5 text-[16px] font-extrabold text-ink">{formatMUR(s.openingFloatCents)}</div></div>
                        <div className="rounded-[13px] bg-sub p-4">
                          <div className="text-[11px] font-semibold text-muted">Cash in{s.cashOutCents !== 0 ? " / out" : ""}</div>
                          <div className="num mt-1.5 text-[16px] font-extrabold text-ink">
                            {formatMUR(s.cashCents)}
                            {s.cashOutCents !== 0 && <span className="text-rose"> {formatMUR(s.cashOutCents)}</span>}
                          </div>
                        </div>
                        <div className="rounded-[13px] bg-sub p-4"><div className="text-[11px] font-semibold text-muted">Counted at close</div><div className="num mt-1.5 text-[16px] font-extrabold text-ink">{formatMUR(s.countedCents ?? 0)}</div></div>
                        <div className="rounded-[13px] bg-sub p-4">
                          <div className="text-[11px] font-semibold text-muted">Variance</div>
                          <div className={`num mt-1.5 text-[16px] font-extrabold ${(s.varianceCents ?? 0) === 0 ? "text-mint" : (s.varianceCents ?? 0) < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(s.varianceCents ?? 0)}</div>
                        </div>
                      </div>
                      {(s.nonCash.length > 0 || s.cashOutCents !== 0) && (
                        <div className="mt-3 rounded-[12px] border border-[rgba(43,140,255,0.2)] bg-[rgba(43,140,255,0.05)] px-4 py-2.5 text-[12.5px] text-body">
                          {s.nonCash.length > 0 && (
                            <>
                              <span className="font-bold text-link">Not in the drawer:</span>{" "}
                              {s.nonCash.map((n) => `${METHOD_LABEL[n.method] ?? n.method} ${formatMUR(n.cents)} straight to the bank`).join(" · ")}
                            </>
                          )}
                          {s.cashOutCents !== 0 && (
                            <span>{s.nonCash.length > 0 ? " · " : ""}<span className="font-bold text-rose">Petty cash out</span> {formatMUR(s.cashOutCents)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Cash movements over a period */}
              <div className="rounded-[15px] border border-line bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-[15px] font-bold text-ink-strong">Cash movements</div>
                    <p className="mt-0.5 text-[12px] text-muted">Every payment in and out of this till over the period.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {device.till && <CashOutButton sessionId={device.till.sessionId} expectedCents={device.till.expectedCents} />}
                    <DateRangeFilter label={false} />
                  </div>
                </div>

                {/* Inflows */}
                <div className="mt-4 overflow-hidden rounded-[13px] border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-band px-4 py-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-th">Cash inflows</span>
                    <span className="num text-[12px] font-bold text-mint">{formatMUR(inflowTotal)}</span>
                  </div>
                  <div className="hidden grid-cols-[150px_1fr_110px_100px_120px] gap-3 border-b border-line bg-sub px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-faint md:grid">
                    <span>Date</span><span>User</span><span>Method</span><span>Ref</span><span className="text-right">Amount</span>
                  </div>
                  {cashflow.inflows.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[12.5px] text-faint">No data for this period.</div>
                  ) : (
                    cashflow.inflows.map((m) => (
                      <div key={m.id} className={`border-b border-line px-4 py-2.5 last:border-b-0 ${m.wasReversed ? "bg-[rgba(15,23,32,0.02)]" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] md:hidden">
                          <span className="num text-muted">{m.at}</span>
                          <span className="rounded-[5px] bg-sub px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">{METHOD_LABEL[m.method] ?? m.method}</span>
                          {m.wasReversed && <span className="rounded-[5px] bg-[rgba(214,59,80,0.12)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-rose">Reversed</span>}
                          <span className={`num ml-auto font-bold ${m.wasReversed ? "text-faint line-through" : "text-ink"}`}>{formatMUR(m.amountCents)}</span>
                        </div>
                        <div className="hidden grid-cols-[150px_1fr_110px_100px_120px] items-center gap-3 text-[12.5px] md:grid">
                          <span className="num text-muted">{m.at}</span>
                          <span className={`truncate ${m.wasReversed ? "text-faint" : "text-body"}`}>{m.byName ?? "—"}</span>
                          <span className="flex items-center gap-1.5 text-muted">
                            {METHOD_LABEL[m.method] ?? m.method}
                            {m.wasReversed && <span className="rounded-[5px] bg-[rgba(214,59,80,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose">Reversed</span>}
                          </span>
                          {m.docId ? (
                            <Link href={`/sales/${m.docId}`} className={`num font-bold hover:underline ${m.wasReversed ? "text-faint" : "text-link"}`}>{m.number ?? "—"}</Link>
                          ) : (
                            <span className={`num font-bold ${m.wasReversed ? "text-faint" : "text-link"}`}>{m.number ?? "—"}</span>
                          )}
                          <span className={`num text-right font-bold ${m.wasReversed ? "text-faint line-through" : "text-ink"}`}>{formatMUR(m.amountCents)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Outflows */}
                <div className="mt-4 overflow-hidden rounded-[13px] border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-band px-4 py-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-th">Cash outflows</span>
                    <span className="num text-[12px] font-bold text-rose">{formatMUR(outflowTotal)}</span>
                  </div>
                  <div className="hidden grid-cols-[150px_1fr_110px_120px_130px_1fr] gap-3 border-b border-line bg-sub px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-faint md:grid">
                    <span>Date</span><span>User</span><span>Method</span><span className="text-right">Amount</span><span>Type</span><span>Comment</span>
                  </div>
                  {cashflow.outflows.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[12.5px] text-faint">No data for this period.</div>
                  ) : (
                    cashflow.outflows.map((m) => (
                      <div key={m.key} className={`border-b border-line px-4 py-2.5 last:border-b-0 ${m.cancelled ? "bg-[rgba(15,23,32,0.02)]" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] md:hidden">
                          <span className="num text-muted">{m.at}</span>
                          <span className="rounded-[5px] bg-[rgba(214,59,80,0.08)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose">{METHOD_LABEL[m.method] ?? m.method}</span>
                          <span className={`num ml-auto font-bold ${m.cancelled ? "text-faint line-through" : "text-rose"}`}>{formatMUR(m.amountCents)}</span>
                        </div>
                        <div className="hidden grid-cols-[150px_1fr_110px_120px_130px_1fr] items-center gap-3 text-[12.5px] md:grid">
                          <span className="num text-muted">{m.at}</span>
                          <span className={`truncate ${m.cancelled ? "text-faint" : "text-body"}`}>{m.byName ?? "—"}</span>
                          <span className={m.cancelled ? "text-faint" : "text-muted"}>{METHOD_LABEL[m.method] ?? m.method}</span>
                          <span className={`num text-right font-bold ${m.cancelled ? "text-faint line-through" : "text-rose"}`}>{formatMUR(m.amountCents)}</span>
                          <span className={m.cancelled ? "text-faint" : "text-muted"}>{m.type}</span>
                          {m.docId ? (
                            <Link href={`/sales/${m.docId}`} className={`num truncate font-bold hover:underline ${m.cancelled ? "text-faint" : "text-link"}`}>{m.comment || "—"}</Link>
                          ) : (
                            <span className={`num truncate ${m.cancelled ? "text-faint" : "text-muted"}`}>{m.comment || "—"}</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── TRACEABILITY — date-driven, refs clickable ── */}
          {tab === "trace" && (
            <div className="max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[12px] text-muted">
                  Everything this device did in the period — operators, tills, sales, discounts, receipts, corrections.
                </span>
                <DateRangeFilter label={false} />
              </div>
              {trace.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">
                  Nothing recorded in this period.
                </div>
              ) : (
                <div className="flex flex-col">
                  {trace.map((e) => {
                    const K = KIND_ICON[e.kind] ?? CircleDot;
                    return (
                      <div key={e.key} className="relative flex gap-3.5 pb-5 last:pb-0">
                        {/* rail */}
                        <div className="flex flex-col items-center">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line-2 bg-card text-body">
                            <K size={15} strokeWidth={2.1} />
                          </span>
                          <span className="mt-1 w-px flex-1 bg-line" />
                        </div>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex flex-wrap items-baseline gap-x-2.5">
                            {e.href ? (
                              <Link href={e.href} className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-link hover:underline">{e.title}</Link>
                            ) : (
                              <span className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-ink">{e.title}</span>
                            )}
                            <span className="num text-[11px] text-faint">{e.atLabel}</span>
                          </div>
                          {e.detail && (
                            <div className="mt-0.5 text-[12.5px] text-muted">
                              {e.href ? <Link href={e.href} className="hover:underline">{e.detail}</Link> : e.detail}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
