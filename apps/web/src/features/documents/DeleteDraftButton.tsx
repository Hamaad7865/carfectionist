"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/form";
import { deleteDraftAction } from "./actions";

/** Discard an unissued draft. Draft-only by design — issued documents carry a
 *  fiscal number and can only be voided or credited, never deleted. */
export function DeleteDraftButton({ documentId, docType }: { documentId: string; docType: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    setBusy(true);
    const res = await deleteDraftAction(documentId);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.push("/sales");
    } else setError(res.error);
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        title="Delete this draft"
        className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[rgba(214,59,80,0.35)] bg-card px-3 text-[13px] font-semibold text-rose hover:bg-[rgba(214,59,80,0.06)]"
      >
        <Trash2 size={15} /> Delete draft
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Delete this ${docType} draft?`}
        subtitle="It hasn’t been issued, so nothing in the ledger changes."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="inline-flex h-10 items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold text-muted">Cancel</button>
            <button onClick={confirmDelete} disabled={busy} className="inline-flex h-10 items-center justify-center rounded-[11px] bg-rose px-5 text-[13px] font-bold text-white disabled:opacity-60">
              {busy ? "Deleting…" : "Delete draft"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          <p className="text-[13px] text-body">The draft and its lines are removed for good. This can’t be undone.</p>
        </div>
      </Modal>
    </>
  );
}
