"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, KeyRound, Loader2 } from "lucide-react";
import { getApprovingOwnersAction, type ApprovingOwner } from "@/features/documents/actions";
import { btn } from "@/components/ui/button";

/** The one move the owner is approving — the approval is only good for exactly this. */
export interface PendingAdjustment {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  qty: number;
  unit: string;
  note: string;
}

const PIN_RE = /^[0-9]{4}$/;

function pinErrorCopy(reason: string | undefined): string {
  switch (reason) {
    case "locked":
      return "Too many wrong attempts — that PIN is locked for a few minutes.";
    case "bad_pin":
      return "That PIN wasn't right.";
    case "no_pin":
      return "This owner hasn't set a tablet PIN yet.";
    default:
      return "That PIN wasn't accepted.";
  }
}

async function requestApproval(ownerId: string, pin: string, a: PendingAdjustment): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch("/api/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appUserId: ownerId,
        pin,
        kind: "stock_adjustment",
        refType: "product",
        refId: a.productId,
        reason: a.note,
        locationId: a.locationId,
        qty: a.qty,
      }),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server — try again." };
  }
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
  if (body?.error === "pin_rejected") return { ok: false, error: pinErrorCopy(body.reason) };
  if (body?.error === "not_owner") return { ok: false, error: "That didn't check out as an owner — try again." };
  if (res.status === 403) return { ok: false, error: "You're not able to ask for an approval from here." };
  return { ok: false, error: "Couldn't reach the server — try again." };
}

/**
 * "Ask the owner" for a manual stock adjustment. The owner walks over, picks their name and
 * types their own PIN; nobody is signed out. The approval is single-use and bound to this
 * product, location and quantity — record_stock_adjustment consumes it when [onApproved]
 * records the move.
 */
export function StockApprovalDialog({
  adjustment,
  onClose,
  onApproved,
}: {
  adjustment: PendingAdjustment;
  onClose: () => void;
  onApproved: () => void;
}) {
  const [owners, setOwners] = useState<ApprovingOwner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getApprovingOwnersAction().then((r) => {
      if (!alive) return;
      if (r.ok) {
        setOwners(r.data);
        if (r.data.length === 1) setOwnerId(r.data[0].appUserId);
      } else setLoadError(r.error);
    });
    return () => { alive = false; };
  }, []);

  const canSubmit = !!ownerId && PIN_RE.test(pin) && !busy;
  const a = adjustment;
  const move = `${a.qty > 0 ? "Add" : "Remove"} ${Math.abs(a.qty)}${a.unit ? ` ${a.unit}` : ""}`;

  async function approve() {
    if (!ownerId) return;
    setBusy(true);
    setError(null);
    const r = await requestApproval(ownerId, pin, a);
    setBusy(false);
    // The PIN has done its job either way — never held past the one request.
    setPin("");
    if (!r.ok) return setError(r.error);
    onApproved();
  }

  // Only ever opened from a click, so document exists — no SSR guard needed.
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Owner approval for a stock adjustment"
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-[18px] border border-line bg-card shadow-[0_24px_60px_rgba(6,12,20,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-[10px] bg-brand-wash text-link">
              <KeyRound size={18} />
            </span>
            <div>
              <div className="font-display text-[16px] font-extrabold text-ink-strong">Ask the owner</div>
              <div className="text-[12px] text-muted">Stock adjustments need an owner&rsquo;s PIN.</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-2 bg-sub text-muted hover:text-body">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div className="rounded-[12px] border border-line bg-sub px-3.5 py-2.5 text-[13px]">
            <div className="font-semibold text-ink-strong">{a.productName}</div>
            <div className="mt-0.5 text-muted">
              <span className={`num font-bold ${a.qty < 0 ? "text-rose" : "text-mint"}`}>{move}</span> at {a.locationName}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-faint">Reason: {a.note}</div>
          </div>

          {loadError ? (
            <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{loadError}</p>
          ) : owners === null ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-muted">
              <Loader2 size={15} className="animate-spin" /> Loading owners…
            </div>
          ) : owners.length === 0 ? (
            <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">
              No active owner is set up on this account yet.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Approving owner</span>
                <div className="flex flex-wrap gap-1.5">
                  {owners.map((o) => (
                    <button
                      key={o.appUserId}
                      type="button"
                      aria-pressed={ownerId === o.appUserId}
                      onClick={() => { setOwnerId(o.appUserId); setError(null); }}
                      className={`h-9 rounded-[9px] px-3 text-[12.5px] font-bold ${ownerId === o.appUserId ? "grad-brand text-white" : "border border-line-2 bg-sub text-body hover:border-brand"}`}
                    >
                      {o.displayName}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Owner&rsquo;s PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) approve(); }}
                  placeholder="••••"
                  className="num h-11 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-center text-[22px] tracking-[0.5em] text-ink outline-none focus:border-brand"
                />
              </label>
              {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <button onClick={onClose} className="text-[13px] font-semibold text-muted hover:text-body">Cancel</button>
          <button onClick={approve} disabled={!canSubmit} className={btn("primary", "lg", "gap-2")}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
            {busy ? "Checking…" : "Approve & record"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
