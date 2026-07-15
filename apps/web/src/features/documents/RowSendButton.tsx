"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { SendDocumentDialog } from "./SendDocumentDialog";

// A compact "send" affordance for a list row. The row is a <Link>, so the click
// must not navigate — it opens the send sheet instead. Lives on every quote and
// invoice row (documents list + tickets history), so a document can be sent
// from anywhere it appears, not only its own page.
export function RowSendButton({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="Send to customer"
        aria-label="Send to customer"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="grid size-8 place-items-center rounded-[8px] border border-line-2 bg-card text-[#1DA851] hover:border-[#25D366] hover:bg-[rgba(37,211,102,0.06)]"
      >
        <Send size={14} />
      </button>
      {open && <SendDocumentDialog documentId={documentId} channel="whatsapp" onClose={() => setOpen(false)} />}
    </>
  );
}
