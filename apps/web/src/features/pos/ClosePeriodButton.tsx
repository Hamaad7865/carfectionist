"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { closePeriodAction } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** Owner-only monthly close: snapshots the month's totals + logs the event. */
export function ClosePeriodButton({ period }: { period: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    const r = await closePeriodAction({ period });
    setBusy(false);
    if (r.ok) { setOpen(false); router.refresh(); } else setError(r.error);
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3.5 text-[12.5px] font-bold text-body hover:border-brand"
      >
        <CalendarCheck size={15} /> Close {monthLabel(period)}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Close ${monthLabel(period)}?`}
        subtitle="Snapshots the month's totals (sales, VAT, takings by method and device) and records it in the trail. A month can only be closed once."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={confirm} disabled={busy} className="grad-brand shadow-brand inline-flex h-10 items-center justify-center rounded-[11px] px-5 text-[13px] font-bold text-white disabled:opacity-60">
              {busy ? "Closing…" : "Close the month"}
            </button>
          </div>
        }
      >
        <FormError error={error} />
        <p className="text-[13px] text-body">
          Invoices are already locked the moment they're issued, so this doesn't change any figures — it declares the month done and freezes a copy of its totals for the record.
        </p>
      </Modal>
    </>
  );
}
