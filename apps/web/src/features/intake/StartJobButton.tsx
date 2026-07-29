"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, Check } from "lucide-react";
import { createJobFromDocumentAction, acceptQuoteOnlyAction } from "./actions";
import { btn } from "@/components/ui/button";

export function StartJobButton({
  documentId,
  quote = false,
  alreadyAccepted = false,
}: {
  documentId: string;
  quote?: boolean;
  /** The quote is already signed (status='accepted') with no job yet — the
   *  "accept only" choice was already made, so only starting the job is left. */
  alreadyAccepted?: boolean;
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
  async function acceptOnly() {
    setBusy("accept");
    setError(null);
    const r = await acceptQuoteOnlyAction(documentId);
    if (r.ok) router.refresh();
    else {
      setBusy(null);
      setError(r.error);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={startJob}
          disabled={busy !== null}
          className={btn("primary", "lg", "gap-2")}
        >
          {/* Accepting a quote issues + numbers it — say so (same wording as the POS). */}
          <Wrench size={15} />{" "}
          {busy === "job" ? "Starting job…" : quote && !alreadyAccepted ? "Accept → create job" : "Start job →"}
        </button>
        {quote && !alreadyAccepted && (
          <button
            onClick={acceptOnly}
            disabled={busy !== null}
            className={btn("quiet", "lg", "gap-2")}
          >
            <Check size={15} /> {busy === "accept" ? "Accepting…" : "Accept only (book later)"}
          </button>
        )}
      </div>
      {error && <p className="text-[12px] text-rose">{error}</p>}
    </div>
  );
}
