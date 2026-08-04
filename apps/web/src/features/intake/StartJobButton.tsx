"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, Check } from "lucide-react";
import { createJobFromDocumentAction, acceptQuoteOnlyAction } from "./actions";
import { convertQuoteToInvoiceAction } from "@/features/documents/actions";
import { btn } from "@/components/ui/button";

export function StartJobButton({
  documentId,
  quote = false,
  alreadyAccepted = false,
  hasService = true,
}: {
  documentId: string;
  quote?: boolean;
  /** The quote is already signed (status='accepted') with no job yet — the
   *  "accept only" choice was already made, so only starting the job is left. */
  alreadyAccepted?: boolean;
  /** Is there work on this quote? Work on a car belongs on the jobs board; goods over
   *  the counter are a sale and belong nowhere near the bays, so a products-only quote
   *  leads with accepting and keeps raising a job as the second option — never removes
   *  it, because the odd products-only job does happen. */
  hasService?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"job" | "accept" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startJob() {
    setBusy("job");
    setError(null);
    const r = await createJobFromDocumentAction(documentId);
    if (r.ok && r.data) router.push(`/jobs/${r.data.jobId}`);
    else {
      setBusy(null);
      setError(r.ok ? "Could not start the job." : r.error);
    }
  }

  // Signed, but the car isn't here yet — accept the price with nothing on the
  // board. "Accept → create job" on this same quote raises it whenever the
  // customer comes back (convert_quote_to_job accepts an already-accepted quote).
  //
  // GOODS ONLY: accepting is a purchase happening now, not a promise of work —
  // so the bill follows immediately and the page goes to it, where issuing and
  // recording the payment live. Billing is best-effort: a hiccup there must not
  // un-accept the quote; "Convert to invoice" picks it up idempotently.
  async function acceptOnly() {
    setBusy("accept");
    setError(null);
    const r = await acceptQuoteOnlyAction(documentId);
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    if (!hasService) {
      const inv = await convertQuoteToInvoiceAction(documentId);
      if (inv.ok) return router.push(`/sales/${inv.data.id}/edit`);
    }
    router.refresh();
  }

  // A products-only quote leads with accepting: nobody is working on a car, so there is
  // nothing to put through the bays. Both actions stay on screen either way — this
  // decides which one is the obvious one, not which one is possible.
  const jobLeads = hasService || alreadyAccepted;
  const canAcceptOnly = quote && !alreadyAccepted;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {canAcceptOnly && !jobLeads && (
          <button onClick={acceptOnly} disabled={busy !== null} className={btn("primary", "lg", "gap-2")}>
            <Check size={15} /> {busy === "accept" ? "Accepting…" : "Accept → create invoice"}
          </button>
        )}
        <button
          onClick={startJob}
          disabled={busy !== null}
          className={btn(jobLeads ? "primary" : "quiet", "lg", "gap-2")}
        >
          {/* Accepting a quote issues + numbers it — say so (same wording as the POS). */}
          <Wrench size={15} />{" "}
          {busy === "job" ? "Starting job…" : quote && !alreadyAccepted ? "Accept → create job" : "Start job →"}
        </button>
        {canAcceptOnly && jobLeads && (
          <button onClick={acceptOnly} disabled={busy !== null} className={btn("quiet", "lg", "gap-2")}>
            <Check size={15} /> {busy === "accept" ? "Accepting…" : "Accept only (book later)"}
          </button>
        )}
      </div>
      {error && <p className="text-[12px] text-rose">{error}</p>}
    </div>
  );
}
