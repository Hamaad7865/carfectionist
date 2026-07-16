"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { deliverOnAccountAction } from "./actions";

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
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[rgba(255,176,32,0.4)] bg-card px-3.5 text-[13px] font-bold text-amber-ink hover:bg-[rgba(255,176,32,0.06)]"
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
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={confirm} disabled={busy} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] bg-amber px-5 text-[13px] font-bold text-white disabled:opacity-60">
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
