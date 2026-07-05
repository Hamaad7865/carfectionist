"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { reviseQuoteAction } from "./actions";

export function ReviseButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revise() {
    setError(null);
    setBusy(true);
    const res = await reviseQuoteAction(quoteId);
    setBusy(false);
    if (res.ok) router.push(`/sales/${res.data.id}/edit`);
    else setError(res.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={revise}
        disabled={busy}
        title="Create an editable copy as a new draft quote"
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3.5 text-[13px] font-bold text-body hover:border-brand disabled:opacity-60"
      >
        <PencilLine size={15} /> {busy ? "Revising…" : "Revise"}
      </button>
      {error && <span className="text-[11px] text-rose">{error}</span>}
    </div>
  );
}
