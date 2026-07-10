"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { openTillAction, closeTillAction } from "./actions";
import type { OpenTill, ClosedTill } from "@/lib/supabase/queries/cash";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[14px] text-ink outline-none focus:border-brand";

export function CashSessions({ open, recent }: { open: OpenTill | null; recent: ClosedTill[] }) {
  const router = useRouter();
  const [floatStr, setFloatStr] = useState("");
  const [countStr, setCountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedCents = parseMoneyInput(countStr);
  const varianceCents = open && countedCents != null ? countedCents - open.expectedCents : null;

  async function openTill() {
    setError(null);
    const c = parseMoneyInput(floatStr) ?? 0;
    setBusy(true);
    const r = await openTillAction({ openingFloatCents: c });
    setBusy(false);
    if (r.ok) { setFloatStr(""); router.refresh(); } else setError(r.error);
  }
  async function closeTill() {
    if (!open) return;
    setError(null);
    if (countedCents == null) return setError("Enter the counted cash.");
    setBusy(true);
    const r = await closeTillAction({ id: open.id, countedCents });
    setBusy(false);
    if (r.ok) { setCountStr(""); router.refresh(); } else setError(r.error);
  }

  return (
    <div className="max-w-2xl">
      {error && <p className="mb-3 rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}

      {open ? (
        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-mint" />
            <span className="text-[13px] font-bold text-ink">Till open · {open.deviceId}</span>
            <span className="num ml-auto text-[11px] text-faint">since {open.openedAt.slice(0, 16).replace("T", " ")}</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
            <div className="rounded-[12px] bg-sub p-3"><div className="text-muted">Opening float</div><div className="num mt-1 text-[16px] font-bold text-ink">{formatMUR(open.openingFloatCents)}</div></div>
            <div className="rounded-[12px] bg-sub p-3"><div className="text-muted">Cash collected</div><div className="num mt-1 text-[16px] font-bold text-ink">{formatMUR(open.cashCollectedCents)}</div></div>
            <div className="rounded-[12px] border border-[rgba(43,140,255,0.25)] p-3" style={{ background: "linear-gradient(150deg,#e8f1ff,#dbe9ff)" }}><div className="text-[#3d5978]">Expected in drawer</div><div className="num mt-1 text-[16px] font-extrabold text-[#0f2f5e]">{formatMUR(open.expectedCents)}</div></div>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint">Counted cash at close</span>
              <input className={field} value={countStr} onChange={(e) => setCountStr(e.target.value)} inputMode="decimal" placeholder="Rs …" />
            </label>
            {varianceCents != null && (
              <div className="mt-2 flex items-center justify-between text-[13px]">
                <span className="text-muted">Variance (counted − expected)</span>
                <span className={`num font-bold ${varianceCents === 0 ? "text-mint" : varianceCents < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(varianceCents)}</span>
              </div>
            )}
            <button onClick={closeTill} disabled={busy} className="grad-brand shadow-brand mt-4 flex h-10 w-full items-center justify-center rounded-[11px] font-bold text-white disabled:opacity-60">
              {busy ? "Closing…" : "Close till"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-[15px] border border-line bg-card p-5">
          <div className="text-[14px] font-bold text-ink">Open the till</div>
          <p className="mt-1 text-[12.5px] text-muted">Set the opening float; cash payments will be tracked against this session.</p>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint">Opening float (Rs)</span>
            <input className={field} value={floatStr} onChange={(e) => setFloatStr(e.target.value)} inputMode="decimal" placeholder="e.g. 2000" />
          </label>
          <button onClick={openTill} disabled={busy} className="grad-brand shadow-brand mt-4 flex h-10 w-full items-center justify-center rounded-[11px] font-bold text-white disabled:opacity-60">
            {busy ? "Opening…" : "Open till"}
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-[14px] border border-line bg-card">
          <div className="border-b border-line px-5 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Recent cash-ups</div>
          <div className="grid grid-cols-[1fr_110px_110px_110px] gap-3 border-b border-line bg-sub px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-th">
            <span>Opened</span><span className="text-right">Expected</span><span className="text-right">Counted</span><span className="text-right">Variance</span>
          </div>
          {recent.map((s) => (
            <div key={s.id} className="grid grid-cols-[1fr_110px_110px_110px] items-center gap-3 border-b border-line px-5 py-3 text-[12.5px]">
              <span className="num text-muted">{s.openedAt.slice(0, 10)}</span>
              <span className="num text-right text-body">{formatMUR(s.expectedCents)}</span>
              <span className="num text-right text-body">{formatMUR(s.countedCents)}</span>
              <span className={`num text-right font-bold ${s.varianceCents === 0 ? "text-mint" : s.varianceCents < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(s.varianceCents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
