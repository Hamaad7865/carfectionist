"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { formatMUR, parseMoneyInput } from "@/lib/money";
import { tillCashOutAction } from "./actions";

/** Manual petty cash out of the open till (Cashmag's "Autre" rows) — amount +
 *  reason, capped server-side at what the drawer actually holds. */
export function CashOutButton({ sessionId, expectedCents }: { sessionId: string; expectedCents: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID()); // idempotent per attempt

  const amountCents = parseMoneyInput(amountStr);

  async function confirm() {
    if (amountCents == null || amountCents <= 0) return setError("Enter the amount taken out.");
    if (!reason.trim()) return setError("Say what the cash was for.");
    setError(null);
    setBusy(true);
    const r = await tillCashOutAction({ sessionId, amountCents, reason: reason.trim(), idempotencyKey: key });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setAmountStr("");
      setReason("");
      setKey(crypto.randomUUID());
      router.refresh();
    } else setError(r.error);
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3.5 text-[12.5px] font-bold text-body hover:border-brand"
      >
        <Banknote size={15} /> Cash out
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Take cash out of the till"
        subtitle={`Petty cash for small purchases. ${formatMUR(expectedCents)} is in the drawer right now.`}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={confirm} disabled={busy} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
              {busy ? "Recording…" : "Record cash out"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Amount (Rs)">
            <input className={inputCls} value={amountStr} onChange={(e) => setAmountStr(e.target.value)} inputMode="decimal" placeholder="e.g. 190" autoFocus />
          </Field>
          <Field label="Reason" hint="Shows in Cash outflows and the traceability trail.">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. brushes, crest, pinkie" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
