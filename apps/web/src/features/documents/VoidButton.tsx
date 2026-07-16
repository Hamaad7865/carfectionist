"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { voidDocumentAction } from "./actions";
import { btn, btnBase } from "@/components/ui/button";

export function VoidButton({ documentId, number }: { documentId: string; number: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmVoid() {
    setError(null);
    setBusy(true);
    const res = await voidDocumentAction(documentId, reason);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error);
  }

  return (
    <>
      <button
        onClick={() => { setReason(""); setError(null); setOpen(true); }}
        className={btn("danger", "md", "border-[rgba(214,59,80,0.35)] text-rose hover:bg-[rgba(214,59,80,0.06)]")}
      >
        <Ban size={15} /> Void
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Void ${number ?? "invoice"}?`}
        subtitle="The number is kept and reversal stock movements are recorded. This can’t be undone."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>Cancel</button>
            <button onClick={confirmVoid} disabled={busy} className={btnBase("lg", "bg-rose px-5 font-bold text-white")}>
              {busy ? "Voiding…" : "Void invoice"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <Field label="Reason" hint="Shown in the audit trail.">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Issued to the wrong customer" autoFocus />
          </Field>
        </div>
      </Modal>
    </>
  );
}
