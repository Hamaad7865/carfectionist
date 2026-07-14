"use client";

import { useState } from "react";
import { Send, Mail, MessageCircle, X, Check } from "lucide-react";
import { sendDocumentAction } from "./actions";

// "Send to customer" on the document page — email the PDF or WhatsApp it as a
// document message. Same engine the tablet uses after a client signs.

// Message presets the operator can pick, then edit freely. On WhatsApp the text
// travels as a variable inside the one Meta-approved template; on email it goes
// straight into the body.
const NOTE_PRESETS = [
  { label: "Thank you", text: "Thank you for your business." },
  { label: "As discussed", text: "As discussed — please review and let us know if you have any questions." },
  { label: "Reminder", text: "A gentle reminder regarding this document. We remain at your service." },
];

export function SendDocumentButton({
  documentId,
  defaultEmail,
  defaultPhone,
}: {
  documentId: string;
  defaultEmail: string | null;
  defaultPhone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [to, setTo] = useState(defaultEmail ?? "");
  const [note, setNote] = useState(NOTE_PRESETS[0].text);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(c: "email" | "whatsapp") {
    setChannel(c);
    setTo(c === "email" ? defaultEmail ?? "" : defaultPhone ?? "");
    setError(null);
    setDone(false);
  }

  async function send() {
    setBusy(true);
    setError(null);
    const r = await sendDocumentAction({ documentId, channel, to, note: note.trim() || undefined });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.error);
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); pick("email"); }}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-semibold text-body hover:border-brand"
      >
        <Send size={15} /> Send to customer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-[16px] border border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-display text-[15px] font-bold text-ink-strong">Send to customer</span>
              <button onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-[9px] border border-line-2 bg-sub text-muted hover:text-body"><X size={15} /></button>
            </div>

            <div className="mt-3.5 flex gap-1.5">
              <button onClick={() => pick("email")} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-bold ${channel === "email" ? "grad-brand text-white" : "border border-line-2 bg-sub text-body"}`}>
                <Mail size={14} /> Email
              </button>
              <button onClick={() => pick("whatsapp")} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-bold ${channel === "whatsapp" ? "bg-[#25D366] text-[#06231A]" : "border border-line-2 bg-sub text-body"}`}>
                <MessageCircle size={14} /> WhatsApp
              </button>
            </div>

            <label className="mt-3 flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{channel === "email" ? "Email address" : "Phone number"}</span>
              <input
                className="h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
                value={to}
                onChange={(e) => { setTo(e.target.value); setDone(false); }}
                placeholder={channel === "email" ? "customer@email.com" : "+230 5XXX XXXX"}
                inputMode={channel === "email" ? "email" : "tel"}
              />
            </label>

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Message</span>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => { setNote(p.text); setDone(false); }}
                    className={`h-7 rounded-[8px] px-2.5 text-[11.5px] font-semibold ${note === p.text ? "grad-brand text-white" : "border border-line-2 bg-sub text-body"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value.slice(0, 300)); setDone(false); }}
                rows={2}
                className="w-full resize-none rounded-[11px] border border-line-2 bg-sub px-3 py-2 text-[13px] leading-snug text-ink outline-none focus:border-brand"
                placeholder="Message to the customer…"
              />
            </div>

            {error && <p className="mt-3 rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
            {done && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-[9px] bg-[rgba(13,167,124,0.1)] px-3 py-2 text-[12.5px] font-semibold text-mint">
                <Check size={14} /> Sent — the customer will receive the PDF.
              </p>
            )}

            <button
              onClick={send}
              disabled={busy || done || !to.trim()}
              className="grad-brand shadow-brand mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] font-bold text-white disabled:opacity-50"
            >
              <Send size={15} /> {busy ? "Sending…" : done ? "Sent ✓" : "Send PDF"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
