"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { deliverOnAccountAction } from "./actions";
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
