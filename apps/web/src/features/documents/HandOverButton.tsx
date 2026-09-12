"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { deliverOnAccountAction, undoOnAccountAction } from "./actions";
import { btn, btnBase } from "@/components/ui/button";

/** Open bill + READY job: hand the car over ON ACCOUNT — the job delivers, the
 *  balance stays owed on the customer's statement. Same flow as the tablet's
 *  credit collect, through the same RPC. */
export function HandOverButton({ invoiceId, number, customerName, outstanding }: {
  invoiceId: string;
  number: string | null;
  customerName: string | null;
  outstanding: string; // formatted MUR
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    const res = await deliverOnAccountAction(invoiceId);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error);
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className={btn("danger", "md", "border-[rgba(255,176,32,0.4)] text-amber-ink hover:bg-[rgba(255,176,32,0.06)]")}
      >
        <Car size={15} /> Hand over on account
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Hand the car over on account?`}
        subtitle={`${number ?? "This bill"} stays open — ${outstanding} remains owed by ${customerName ?? "the customer"} (shows on their statement and in TO COLLECT). The job moves to Delivered.`}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={confirm} disabled={busy} className={btnBase("lg", "bg-amber px-5 font-bold text-white")}>
              <Car size={15} /> {busy ? "Recording…" : "Car collected — on account"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
        </div>
      </Modal>
    </>
  );
}

/** Walk back a mistaken on-account handover: the job returns to READY, the bill
 *  stays open (same RPC the tablet uses; owner/manager/cashier via
 *  undoOnAccountAction). Rendered only for delivered jobs still showing a
 *  balance — a paid delivery has nothing to undo. */
export function UndoHandoverButton({ invoiceId, number }: {
  invoiceId: string;
  number: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    const res = await undoOnAccountAction(invoiceId);
    setBusy(false);
    if (res.ok) {
      setConfirming(false);
      router.refresh();
    } else setError(res.error);
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button onClick={() => { setError(null); setConfirming(true); }} className={btn("quiet", "sm", "gap-2")}>
          <Undo2 size={14} /> Undo handover
        </button>
        {error && <p className="text-[12px] text-rose">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-sub p-3">
      <p className="text-[12.5px] text-muted">
        Put {number ?? "this bill"}&rsquo;s job back to Ready? The balance stays owed on the bill — only the handover is undone.
      </p>
      <div className="flex gap-2">
        <button onClick={() => setConfirming(false)} className={btn("quiet", "md")}>Keep delivered</button>
        <button onClick={confirm} disabled={busy} className={btn("danger", "md", "gap-2")}>
          <Undo2 size={14} /> {busy ? "Undoing…" : "Undo handover"}
        </button>
      </div>
      {error && <p className="text-[12px] text-rose">{error}</p>}
    </div>
  );
}
