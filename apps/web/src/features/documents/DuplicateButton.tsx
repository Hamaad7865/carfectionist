"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { duplicateDocumentAction } from "./actions";
import { btn } from "@/components/ui/button";

export function DuplicateButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    setError(null);
    setBusy(true);
    const res = await duplicateDocumentAction(documentId);
    setBusy(false);
    if (res.ok) router.push(`/sales/${res.data.id}/edit`);
    else setError(res.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={duplicate}
        disabled={busy}
        title="Create a new editable draft copy of this document"
        className={btn()}
      >
        <Copy size={15} /> {busy ? "Duplicating…" : "Duplicate"}
      </button>
      {error && <span className="text-[11px] text-rose">{error}</span>}
    </div>
  );
}
