"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, KeyRound, Check, Loader2 } from "lucide-react";
import { getApprovingOwnersAction, type ApprovingOwner } from "./actions";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { btn } from "@/components/ui/button";

// "Ask the owner": the way out of the disabled-Issue dead end when a discount
// is over its ceiling. The owner walks over, picks their name, types their
// OWN PIN, states why, and confirms how much of this discount they are
// approving — nobody is signed out, and the cashier's session never touches
// an owner's password. Modelled on SendDocumentDialog (the closest sibling in
// this folder): same portal-to-body, loading → form → success-flourish shape.

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

async function submitOverride(input: {
  appUserId: string;
  pin: string;
  refId: string;
  reason: string;
  maxDiscountCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch("/api/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appUserId: input.appUserId,
        pin: input.pin,
        kind: "discount",
        refType: "document",
        refId: input.refId,
        reason: input.reason,
        maxDiscountCents: input.maxDiscountCents,
      }),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server — try again." };
  }
  if (res.ok) return { ok: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const respBody = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
  if (respBody?.error === "pin_rejected") return { ok: false, error: pinErrorCopy(respBody.reason) };
  if (respBody?.error === "not_owner") return { ok: false, error: "That didn't check out as an owner — try again." };
  if (res.status === 403) return { ok: false, error: "You're not able to ask for an override from here." };
  if (respBody?.error === "bad_request") return { ok: false, error: "Check the PIN, reason and amount, then try again." };
  return { ok: false, error: "Couldn't reach the server — try again." };
}

export function OwnerOverrideDialog({
  documentId,
  docType,
  requestedCents,
  onClose,
  onApproved,
}: {
  documentId: string;
  docType: "quote" | "invoice";
  /** The discount currently requested on this document, VAT-inclusive cents —
   *  computeAllowance's actualCents. Prefills the approved figure; the owner
   *  can raise or lower it before approving. */
  requestedCents: number;
  onClose: () => void;
  /** Fires once the PIN is accepted. The cents value is exactly what was
   *  submitted — never re-derived from the response. The RPC stores the
   *  ceiling as rupees, and a rupees→cents round trip can land a float a
   *  fraction of a cent off; the figure the caller already holds locally is
   *  the exact one that was approved. */
  onApproved: (maxDiscountCents: number) => void;
}) {
  const [owners, setOwners] = useState<ApprovingOwner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [amountText, setAmountText] = useState(requestedCents ? String(requestedCents / 100) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Portal to <body> — the same reasoning as SendDocumentDialog: this dialog
  // can open from deep inside the builder's own layout (preview iframe, sticky
  // toolbar), and a top-layer portal keeps it from being clipped or z-fought.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getApprovingOwnersAction();
      if (!alive) return;
      if (r.ok) setOwners(r.data);
      else setLoadError(r.error);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Let the "approved" flourish be seen, then close on its own so the cashier
  // isn't left clicking anything with the owner still standing there.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1600);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const parsedCents = parseMoneyInput(amountText);
  const canSubmit =
    !!ownerId && PIN_RE.test(pin) && reason.trim().length > 0 && parsedCents != null && parsedCents > 0 && !busy;

  async function approve() {
    if (!ownerId || parsedCents == null) return;
    setBusy(true);
    setError(null);
    const result = await submitOverride({
      appUserId: ownerId,
      pin,
      refId: documentId,
      reason: reason.trim(),
      maxDiscountCents: parsedCents,
    });
    setBusy(false);
    // Win or lose, the PIN just typed has done its job — it is never held
    // longer than the one request it rode in on.
    setPin("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
    onApproved(parsedCents);
  }

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[18px] border border-line bg-card shadow-[0_24px_60px_rgba(6,12,20,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-[10px] bg-brand-wash text-link">
              <KeyRound size={18} />
            </span>
            <div>
              <div className="font-display text-[16px] font-extrabold text-ink-strong">Ask the owner</div>
              <div className="text-[12px] text-muted">Approve this discount on the {docType} — needs an owner&rsquo;s PIN.</div>
            </div>
          </div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-2 bg-sub text-muted hover:text-body">
            <X size={15} />
          </button>
        </div>

        {/* body */}
        <div className="flex flex-col gap-3.5 px-5 py-4">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="animate-pop-check grid size-16 place-items-center rounded-full bg-[rgba(13,167,124,0.12)] text-mint">
                <Check size={34} strokeWidth={3} />
              </span>
              <div className="font-display text-[17px] font-extrabold text-ink-strong">Approved</div>
              <p className="max-w-[16rem] text-[12.5px] leading-snug text-muted">
                Up to {formatMUR(parsedCents ?? 0)} is now allowed on this {docType}.
              </p>
            </div>
          ) : loadError ? (
            // Checked BEFORE the loading state: on failure, `owners` stays null
            // forever (only a success sets it) — checking `owners === null` first
            // would read a real failure as "still loading" and hang here silently.
            <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{loadError}</p>
          ) : owners === null ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
              <Loader2 size={15} className="animate-spin" /> Loading owners…
            </div>
          ) : owners.length === 0 ? (
            <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">
              No active owner is set up on this account yet.
            </p>
          ) : (
            <>
              {/* owner picker */}
              <Field label="Approving owner">
                <div className="flex flex-wrap gap-1.5">
                  {owners.map((o) => (
                    <button
                      key={o.appUserId}
                      type="button"
                      onClick={() => { setOwnerId(o.appUserId); setError(null); }}
                      className={`h-9 rounded-[9px] px-3 text-[12.5px] font-bold ${ownerId === o.appUserId ? "grad-brand text-white" : "border border-line-2 bg-sub text-body hover:border-brand"}`}
                    >
                      {o.displayName}
                    </button>
                  ))}
                </div>
              </Field>

              {/* PIN — masked, never logged, cleared the instant it's used (see approve()) */}
              <Field label="Owner's PIN">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(null); }}
                  placeholder="••••"
                  className="num h-11 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-center text-[22px] tracking-[0.5em] text-ink outline-none focus:border-brand"
                />
              </Field>

              {/* reason */}
              <Field label="Reason">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. loyal customer, matching a competitor's price"
                  className="h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
                />
              </Field>

              {/* approved figure */}
              <Field label="Approve up to" hint={`The cashier is asking for ${formatMUR(requestedCents)} off this ${docType}.`}>
                <div className="flex h-10 items-stretch overflow-hidden rounded-[11px] border border-line-2 bg-sub focus-within:border-brand">
                  <span className="num flex select-none items-center border-r border-line-2 px-3 text-[13px] text-muted">Rs</span>
                  <input
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="num h-full flex-1 bg-transparent px-3 text-[13px] font-semibold text-ink outline-none"
                  />
                </div>
              </Field>

              {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
            </>
          )}
        </div>

        {/* footer */}
        {!done && (
          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
            <button onClick={onClose} className="text-[13px] font-semibold text-muted hover:text-body">
              Cancel
            </button>
            <button
              onClick={approve}
              disabled={!canSubmit}
              className={btn("primary", "lg", "gap-2")}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
              {busy ? "Checking…" : "Approve"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
  );
}
