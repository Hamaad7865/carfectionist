"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { createJobFromDocumentAction } from "./actions";

export function StartJobButton({ documentId, quote = false }: { documentId: string; quote?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const r = await createJobFromDocumentAction(documentId);
    if (r.ok && r.data) router.push(`/jobs/${r.data.jobId}`);
    else {
      setBusy(false);
      setError(r.ok ? "Could not start the job." : r.error);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        onClick={go}
        disabled={busy}
        className="grad-brand shadow-brand inline-flex h-10 items-center gap-2 rounded-[11px] px-4 text-[13px] font-bold text-white disabled:opacity-60"
      >
        {/* Accepting a quote issues + numbers it — say so (same wording as the POS). */}
        <Wrench size={15} /> {busy ? "Starting job…" : quote ? "Accept → create job" : "Start job →"}
      </button>
      {error && <p className="text-[12px] text-rose">{error}</p>}
    </div>
  );
}
