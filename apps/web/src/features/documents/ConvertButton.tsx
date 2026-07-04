"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertQuoteToInvoiceAction } from "./actions";

export function ConvertButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function convert() {
    setBusy(true);
    const res = await convertQuoteToInvoiceAction(quoteId);
    setBusy(false);
    if (res.ok) router.push(`/sales/${res.data.id}/edit`);
  }

  return (
    <button
      onClick={convert}
      disabled={busy}
      className="inline-flex h-9 items-center rounded-md bg-teal px-3 text-[13px] font-semibold text-graphite-950 hover:bg-teal-bright disabled:opacity-60"
    >
      {busy ? "Converting…" : "Convert to invoice"}
    </button>
  );
}
