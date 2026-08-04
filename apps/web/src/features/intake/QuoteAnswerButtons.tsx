"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, MessageCircle, Phone, Mail } from "lucide-react";
import { acceptQuoteOnlyAction, declineQuoteAction } from "./actions";
import { convertQuoteToInvoiceAction } from "@/features/documents/actions";
import { btn } from "@/components/ui/button";

// A quotation that has been SENT is waiting on one thing: the customer's answer.
// Before this, "yes" could only be recorded by handing them a tablet to sign — impossible
// for a quote sent by WhatsApp — and "no" could only be recorded as VOID, which is what the
// shop calls paperwork raised in error. So every lost sale went into the same bucket as
// every clerical mistake, and the question the owner actually asks ("how many quotes do we
// lose?") had no answer.

const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "phone", label: "Phone", icon: Phone },
  { key: "email", label: "Email", icon: Mail },
] as const;

const REASONS = ["Too expensive", "Going elsewhere", "Not now"];

export function QuoteAnswerButtons({
  documentId,
  customerName,
  hasService,
}: {
  documentId: string;
  customerName: string | null;
  /** Goods only: accepting bills it on the spot, so the page goes to the invoice. */
  hasService: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "yes" | "no">(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function accept(via: "whatsapp" | "phone" | "email") {
    setBusy(true);
    setError(null);
    const r = await acceptQuoteOnlyAction(documentId, via, customerName);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    // Goods agreed remotely still needs billing — same rule as signing in person.
    if (!hasService) {
      const inv = await convertQuoteToInvoiceAction(documentId);
      if (inv.ok) return router.push(`/sales/${inv.data.id}/edit`);
    }
    setBusy(false);
    setOpen(null);
    router.refresh();
  }

  async function decline() {
    setBusy(true);
    setError(null);
    const r = await declineQuoteAction(documentId, reason);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(open === "yes" ? null : "yes")} disabled={busy} className={btn("quiet", "lg", "gap-2")}>
          <Check size={15} /> Customer agreed — not signing here
        </button>
        <button onClick={() => setOpen(open === "no" ? null : "no")} disabled={busy} className={btn("quiet", "lg", "gap-2")}>
          <X size={15} className="text-rose" /> Customer declined
        </button>
      </div>

      {open === "yes" && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-sub p-3">
          <p className="text-[12.5px] text-muted">
            How did {customerName || "the customer"} agree? Recorded against this quotation with the
            time, in place of a signature.
          </p>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => accept(key)} disabled={busy} className={btn("primary", "md", "gap-2")}>
                <Icon size={14} /> {busy ? "Accepting…" : label}
              </button>
            ))}
          </div>
        </div>
      )}

      {open === "no" && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-sub p-3">
          <p className="text-[12.5px] text-muted">
            Marked declined and filed away — kept on the record as a quotation the shop lost.
            Revise it instead if they only want a different price.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(reason === r ? "" : r)}
                className={`h-8 rounded-[9px] border px-2.5 text-[12px] font-semibold ${
                  reason === r ? "border-brand bg-brand-wash text-link" : "border-line-2 bg-card text-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            placeholder="Or type what they said… (optional)"
            className="h-10 w-full rounded-[10px] border border-line-2 bg-card px-3 text-[13px] text-ink outline-none focus:border-brand"
          />
          <button onClick={decline} disabled={busy} className={btn("danger", "md", "gap-2")}>
            <X size={14} /> {busy ? "Working…" : "Mark declined"}
          </button>
        </div>
      )}

      {error && <p className="text-[12px] text-rose">{error}</p>}
    </div>
  );
}
