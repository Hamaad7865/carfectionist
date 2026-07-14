"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertQuoteToInvoiceAction } from "./actions";

export function ConvertButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function convert() {
    setBusy(true);
    setError(null);
    const res = await convertQuoteToInvoiceAction(quoteId);
    setBusy(false);
    if (res.ok) router.push(`/sales/${res.data.id}/edit`);
    else setError(res.error); // e.g. "cannot invoice a declined quote" — was a silent no-op
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="max-w-[220px] truncate text-[11.5px] font-semibold text-rose" title={error}>{error}</span>}
      <button
        onClick={convert}
        disabled={busy}
        className="grad-brand shadow-brand inline-flex h-9 items-center rounded-[10px] px-3.5 text-[13px] font-bold text-white disabled:opacity-60"
      >
        {busy ? "Converting…" : "Convert to invoice"}
      </button>
    </span>
  );
}
