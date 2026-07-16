"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileMinus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { createCreditNoteAction } from "./actions";
import { btn, btnBase } from "@/components/ui/button";

export function CreditNoteButton({ invoiceId, number }: { invoiceId: string; number: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    const res = await createCreditNoteAction(invoiceId, restock);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.push(`/sales/${res.data.id}`);
    } else setError(res.error);
  }

  return (
    <>
      <button
        onClick={() => { setRestock(true); setError(null); setOpen(true); }}
        className={btn("danger")}
      >
        <FileMinus size={15} /> Credit note
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Credit ${number ?? "invoice"}?`}
        subtitle="Issues a credit note (own CN- number) mirroring this invoice — for a refund or correction after payment."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={confirm} disabled={busy} className={btnBase("lg", "bg-pink px-5 font-bold text-white")}>
              <FileMinus size={15} /> {busy ? "Issuing…" : "Issue credit note"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-sub p-3">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 size-4 accent-[#2b8cff]" />
            <span className="text-[12.5px] text-body">
              <span className="font-semibold">Return items to stock</span>
              <span className="mt-0.5 block text-[11.5px] text-muted">Adds back the stocked products on this invoice. Leave off for a pure price correction where nothing is returned.</span>
            </span>
          </label>
        </div>
      </Modal>
    </>
  );
}
