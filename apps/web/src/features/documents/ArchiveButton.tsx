"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveDocumentAction, restoreDocumentAction } from "./actions";
import { btn } from "@/components/ui/button";

/** File a finished document out of the working list — or put it back. Never a
 *  delete: an issued document keeps its number and stays in every report. */
export function ArchiveButton({ documentId, archived }: { documentId: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setBusy(true);
    const res = archived ? await restoreDocumentAction(documentId) : await archiveDocumentAction(documentId);
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        title={archived ? "Put this back in the working list" : "Hide from the working list — stays in reports"}
        className={btn()}
      >
        {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {archived ? "Restore" : "Archive"}
      </button>
      {error && <span className="max-w-[260px] text-right text-[11.5px] text-rose">{error}</span>}
    </div>
  );
}
