import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Power, UserRound, Download, Wallet, CalendarCheck, BadgePercent,
  ReceiptText, FileDown, CircleDot, Coins, Ban, Monitor, TabletSmartphone,
} from "lucide-react";
import { getDeviceDashboard } from "@/lib/supabase/queries/pos-devices";
import { DeviceSettings } from "@/features/pos/DeviceSettings";
import { formatMUR } from "@/lib/money";
import { muDateTime } from "@/lib/mu-date";

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
};

export default async function DeviceDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<{ tab?: string; s?: string }>;
}) {
  const { deviceId } = await params;
  const sp = await searchParams;
  const code = decodeURIComponent(deviceId);
  const data = await getDeviceDashboard(code);
  if (!data) notFound();

  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "general";
  const { device, sessions, trace, todayCents } = data;
  const Icon = device.isBackOffice ? Monitor : TabletSmartphone;
  const selectedSession = sessions.find((s) => s.id === sp.s) ?? sessions[0] ?? null;
  const todayTotal = todayCents.reduce((s, m) => s + m.cents, 0);

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
            return (
              <Link
                key={t.key}
                href={`/point-of-sale/${encodeURIComponent(code)}?tab=${t.key}`}
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

          {/* ── CASH FLOW ── */}
          {tab === "cashflow" && (
            <div className="flex flex-col gap-4">
              {sessions.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">No till sessions on this device yet.</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Session</span>
                    {sessions.slice(0, 8).map((s) => {
                      const on = selectedSession?.id === s.id;
                      return (
                        <Link
                          key={s.id}
                          href={`/point-of-sale/${encodeURIComponent(code)}?tab=cashflow&s=${s.id}`}
                          className={`num inline-flex h-8 items-center rounded-lg border px-3 text-[12px] font-semibold ${on ? "border-link bg-[rgba(43,140,255,0.12)] text-link" : "border-line-2 bg-card text-muted hover:text-body"}`}
                        >
                          {muDateTime(s.openedAt).slice(0, 10)}{s.status === "open" ? " · open" : ""}
                        </Link>
                      );
                    })}
                  </div>

                  {selectedSession && (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-[13px] border border-line bg-card p-4"><div className="text-[11px] font-semibold text-muted">Opening float</div><div className="num mt-1.5 text-[17px] font-extrabold text-ink">{formatMUR(selectedSession.openingFloatCents)}</div></div>
                        <div className="rounded-[13px] border border-line bg-card p-4"><div className="text-[11px] font-semibold text-muted">Cash in</div><div className="num mt-1.5 text-[17px] font-extrabold text-ink">{formatMUR(selectedSession.cashCents)}</div></div>
                        <div className="rounded-[13px] border border-line bg-card p-4"><div className="text-[11px] font-semibold text-muted">{selectedSession.status === "open" ? "Expected now" : "Counted at close"}</div><div className="num mt-1.5 text-[17px] font-extrabold text-ink">{formatMUR(selectedSession.status === "open" ? selectedSession.expectedCents : (selectedSession.countedCents ?? 0))}</div></div>
                        <div className="rounded-[13px] border border-line bg-card p-4">
                          <div className="text-[11px] font-semibold text-muted">Variance</div>
                          <div className={`num mt-1.5 text-[17px] font-extrabold ${selectedSession.varianceCents == null ? "text-faint" : selectedSession.varianceCents === 0 ? "text-mint" : selectedSession.varianceCents < 0 ? "text-rose" : "text-amber-ink"}`}>
                            {selectedSession.varianceCents == null ? "—" : formatMUR(selectedSession.varianceCents)}
                          </div>
                        </div>
                      </div>

                      {selectedSession.nonCash.length > 0 && (
                        <div className="rounded-[13px] border border-[rgba(43,140,255,0.2)] bg-[rgba(43,140,255,0.05)] px-4 py-3 text-[12.5px] text-body">
                          <span className="font-bold text-link">Not in the drawer:</span>{" "}
                          {selectedSession.nonCash.map((n) => `${METHOD_LABEL[n.method] ?? n.method} ${formatMUR(n.cents)} straight to the bank`).join(" · ")}
                        </div>
                      )}

                      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
                        <div className="flex items-center justify-between border-b border-line px-5 py-3">
                          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Movements</span>
                          <span className="text-[11px] text-faint">{selectedSession.movements.length} payment{selectedSession.movements.length === 1 ? "" : "s"}</span>
                        </div>
                        {selectedSession.movements.length === 0 ? (
                          <div className="px-5 py-10 text-center text-[12.5px] text-faint">No payments in this session.</div>
                        ) : (
                          selectedSession.movements.map((m) => (
                            <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-5 py-2.5 text-[12.5px] last:border-b-0">
                              <span className="num text-muted">{m.at.slice(11)}</span>
                              <span className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold uppercase ${m.isReversal ? "bg-[rgba(214,59,80,0.1)] text-rose" : "bg-sub text-muted"}`}>
                                {m.isReversal ? "Reversal" : METHOD_LABEL[m.method] ?? m.method}
                              </span>
                              {m.number && <span className="num font-bold text-link">{m.number}</span>}
                              {m.byName && <span className="text-muted">{m.byName}</span>}
                              <span className={`num ml-auto font-bold ${m.amountCents < 0 ? "text-rose" : "text-ink"}`}>{formatMUR(m.amountCents)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── TRACEABILITY ── */}
          {tab === "trace" && (
            <div className="max-w-3xl">
              {trace.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-line-2 p-10 text-center text-[13px] text-faint">
                  Nothing recorded yet — events appear as the device trades.
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
                            <span className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-ink">{e.title}</span>
                            <span className="num text-[11px] text-faint">{e.atLabel}</span>
                          </div>
                          {e.detail && <div className="mt-0.5 text-[12.5px] text-muted">{e.detail}</div>}
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
