"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { reviseQuoteAction } from "./actions";
import { btn } from "@/components/ui/button";

export function ReviseButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revise() {
    setError(null);
    setBusy(true);
    const res = await reviseQuoteAction(quoteId);
    setBusy(false);
    // In-place since 20260910000110: the RPC reopens THIS quote (same id, same
    // number) instead of forking a new draft, so editing continues here.
    if (res.ok) router.push(`/sales/${res.data.id}/edit`);
    else setError(res.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={revise}
        disabled={busy}
        title="Reopen this quote for editing — same quote, same number, no new draft"
        className={btn()}
      >
        <PencilLine size={15} /> {busy ? "Revising…" : "Revise"}
      </button>
      {error && <span className="text-[11px] text-rose">{error}</span>}
    </div>
  );
}
