"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Power, LayoutDashboard, TabletSmartphone, Monitor } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { muDateTime } from "@/lib/mu-date";
import { powerOffAction } from "./actions";
import { openTillAction } from "@/features/cash/actions";
import type { PosDevice } from "@/lib/supabase/queries/pos-devices";
import { btn } from "@/components/ui/button";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[14px] text-ink outline-none focus:border-brand";

/** Power off = close this device's till for the day (counted cash → variance). */
function PowerOffButton({ device }: { device: PosDevice }) {
  const router = useRouter();
  const till = device.till!;
  const [open, setOpen] = useState(false);
  const [countStr, setCountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countedCents = countStr.trim() === "" ? till.expectedCents : parseMoneyInput(countStr);
  const varianceCents = countedCents != null ? countedCents - till.expectedCents : null;

  async function confirm() {
    if (countedCents == null) return setError("Enter the counted cash.");
    setError(null);
    setBusy(true);
    const r = await powerOffAction({ sessionId: till.sessionId, countedCents });
    setBusy(false);
    if (r.ok) { setOpen(false); router.refresh(); } else setError(r.error);
  }

  return (
    <>
      <button
        onClick={() => { setCountStr(""); setError(null); setOpen(true); }}
        title="Power off — close this till for the day"
        className="grid size-9 place-items-center rounded-full border border-[rgba(214,59,80,0.35)] bg-card text-rose hover:bg-[rgba(214,59,80,0.08)]"
      >
        <Power size={16} strokeWidth={2.4} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Close the day — ${device.name}?`}
        subtitle="Counts the drawer and closes this till. Sales stay untouched."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={confirm} disabled={busy} className="inline-flex h-10 items-center justify-center gap-2 rounded-[11px] bg-rose px-5 text-[13px] font-bold text-white disabled:opacity-60">
              <Power size={15} /> {busy ? "Closing…" : "Power off"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-[12px] bg-sub p-3"><div className="text-muted">Cash collected</div><div className="num mt-1 text-[15px] font-bold text-ink">{formatMUR(till.cashCollectedCents)}</div></div>
            <div className="rounded-[12px] bg-sub p-3"><div className="text-muted">Expected in drawer</div><div className="num mt-1 text-[15px] font-bold text-ink">{formatMUR(till.expectedCents)}</div></div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-faint">Counted cash</span>
            <input className={field} value={countStr} onChange={(e) => setCountStr(e.target.value)} inputMode="decimal" placeholder={`Rs ${(till.expectedCents / 100).toFixed(2)} (expected)`} autoFocus />
          </label>
          {varianceCents != null && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted">Variance (counted − expected)</span>
              <span className={`num font-bold ${varianceCents === 0 ? "text-mint" : varianceCents < 0 ? "text-rose" : "text-amber-ink"}`}>{formatMUR(varianceCents)}</span>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Open the web back-office till (tablets open theirs on-device). */
function OpenTillInline() {
  const router = useRouter();
  const [floatStr, setFloatStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openTill() {
    setError(null);
    setBusy(true);
    const r = await openTillAction({ openingFloatCents: parseMoneyInput(floatStr) ?? 0 });
    setBusy(false);
    if (r.ok) { setFloatStr(""); router.refresh(); } else setError(r.error);
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <FormError error={error} />
      <div className="flex gap-2">
        <input className={`${field} flex-1`} value={floatStr} onChange={(e) => setFloatStr(e.target.value)} inputMode="decimal" placeholder="Opening float (Rs)" />
        <button onClick={openTill} disabled={busy} className="grad-brand shadow-brand h-10 shrink-0 rounded-[11px] px-4 text-[13px] font-bold text-white disabled:opacity-60">
          {busy ? "Opening…" : "Open till"}
        </button>
      </div>
    </div>
  );
}

export function DeviceCard({ device }: { device: PosDevice }) {
  const Icon = device.isBackOffice ? Monitor : TabletSmartphone;
  return (
    <div className={`rounded-[15px] border bg-card p-4 ${device.isActive ? "border-line" : "border-dashed border-line-2 opacity-70"}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-[rgba(43,140,255,0.25)] bg-[rgba(43,140,255,0.08)] text-link">
          <Icon size={20} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-bold text-ink">{device.name}</span>
            {!device.isBackOffice && (
              <span
                title={device.online ? "Online" : `Last seen ${device.lastSeen ? muDateTime(device.lastSeen) : "—"}`}
                className={`size-2 shrink-0 rounded-full ${device.online ? "bg-mint" : "bg-[#c9d2dc]"}`}
              />
            )}
            {!device.isActive && <span className="rounded-[5px] bg-[rgba(15,23,32,0.08)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-faint">Inactive</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            {device.model && <span>{device.model}</span>}
            <span className="num text-faint">#{device.code}</span>
            {device.appVersion && <span className="num rounded-[5px] bg-sub px-1.5 py-0.5 text-[10px] font-semibold text-muted">v{device.appVersion}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {device.till && <PowerOffButton device={device} />}
          <Link
            href={`/point-of-sale/${encodeURIComponent(device.code)}`}
            title="Open dashboard"
            className="grid size-9 place-items-center rounded-full border border-line-2 bg-card text-body hover:border-brand hover:text-link"
          >
            <LayoutDashboard size={16} strokeWidth={2.2} />
          </Link>
        </div>
      </div>

      {device.till ? (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12.5px]">
          <div><div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Till open</div><div className="num mt-0.5 text-muted">{muDateTime(device.till.openedAt).slice(11)}{device.till.openedByName ? ` · ${device.till.openedByName}` : ""}</div></div>
          <div><div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Cash collected</div><div className="num mt-0.5 font-bold text-ink">{formatMUR(device.till.cashCollectedCents)}</div></div>
          <div><div className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Expected</div><div className="num mt-0.5 font-bold text-ink">{formatMUR(device.till.expectedCents)}</div></div>
        </div>
      ) : device.isBackOffice ? (
        <OpenTillInline />
      ) : (
        <div className="mt-3 border-t border-line pt-3 text-[12px] text-faint">
          Till closed{device.isActive ? " — opens from the tablet" : ""}
        </div>
      )}
    </div>
  );
}
