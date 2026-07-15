"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, Download, Share2, ChevronDown, Mail, MessageCircle, Link2, Send, X, Check } from "lucide-react";
import { sendDocumentAction, publicDocLinkAction } from "./actions";

// The "Customise & Share" action set: Print · Download · Email/WhatsApp▾ — the
// split button opens a menu of Send Email / Send WhatsApp / Copy link, each of
// which either opens the send sheet (pre-set to that channel) or copies a public
// link. One place for every way a document leaves the studio.

const NOTE_PRESETS = [
  { label: "Thank you", text: "Thank you for your business." },
  { label: "As discussed", text: "As discussed — please review and let us know if you have any questions." },
  { label: "Reminder", text: "A gentle reminder regarding this document. We remain at your service." },
];

export function DocumentShareBar({
  documentId,
  number,
  defaultEmail,
  defaultPhone,
}: {
  documentId: string;
  number: string | null;
  defaultEmail: string | null;
  defaultPhone: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "email" | "whatsapp">(null);
  const [copied, setCopied] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // dialog state
  const [to, setTo] = useState("");
  const [note, setNote] = useState(NOTE_PRESETS[0].text);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // close the menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function openSend(channel: "email" | "whatsapp") {
    setMenuOpen(false);
    setDialog(channel);
    setTo(channel === "email" ? defaultEmail ?? "" : defaultPhone ?? "");
    setNote(NOTE_PRESETS[0].text);
    setError(null);
    setDone(false);
  }

  async function copyLink() {
    setMenuOpen(false);
    setLinkErr(null);
    const r = await publicDocLinkAction(documentId);
    if (!r.ok) {
      setLinkErr(r.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(r.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — surface the URL so it can be copied by hand
      setLinkErr(r.url);
    }
  }

  async function send() {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    const r = await sendDocumentAction({ documentId, channel: dialog, to, note: note.trim() || undefined });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.error);
  }

  const ghost =
    "flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-semibold text-body hover:border-brand";

  return (
    <>
      <div className="flex items-center gap-1.5">
        <a href={`/print/doc/${documentId}`} target="_blank" rel="noreferrer" className={ghost}>
          <Printer size={15} /> Print
        </a>
        <a href={`/api/documents/${documentId}/pdf`} download={`${number ?? "document"}.pdf`} className={ghost}>
          <Download size={15} /> Download
        </a>

        {/* split Email / WhatsApp button + menu */}
        <div className="relative" ref={wrapRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="grad-brand shadow-brand flex h-[38px] items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-bold text-white"
          >
            <Share2 size={15} /> Email / WhatsApp
            <ChevronDown size={14} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-[12px] border border-line bg-card p-1 shadow-[0_12px_32px_rgba(6,12,20,0.16)]"
            >
              <MenuItem onClick={() => openSend("email")} icon={<Mail size={15} className="text-link" />} label="Send Email" />
              <MenuItem onClick={() => openSend("whatsapp")} icon={<MessageCircle size={15} className="text-[#25D366]" />} label="Send WhatsApp" />
              <div className="my-1 h-px bg-line-2" />
              <MenuItem onClick={copyLink} icon={<Link2 size={15} className="text-muted" />} label="Copy share link" />
            </div>
          )}
        </div>
      </div>

      {/* toast-ish confirmations that don't need the dialog */}
      {copied && (
        <span className="inline-flex items-center gap-1.5 rounded-[9px] bg-[rgba(13,167,124,0.1)] px-2.5 py-1.5 text-[12px] font-semibold text-mint">
          <Check size={13} /> Link copied
        </span>
      )}
      {linkErr && (
        <span className="max-w-[240px] truncate rounded-[9px] bg-sub px-2.5 py-1.5 text-[11.5px] text-muted" title={linkErr}>
          {linkErr}
        </span>
      )}

      {/* the send sheet, opened pre-set to a channel */}
      {dialog && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={() => setDialog(null)}>
          <div className="w-full max-w-sm rounded-[16px] border border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-display text-[15px] font-bold text-ink-strong">
                Send {dialog === "email" ? "by email" : "on WhatsApp"}
              </span>
              <button onClick={() => setDialog(null)} className="grid size-8 place-items-center rounded-[9px] border border-line-2 bg-sub text-muted hover:text-body">
                <X size={15} />
              </button>
            </div>

            <label className="mt-3.5 flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">
                {dialog === "email" ? "Email address" : "Phone number"}
              </span>
              <input
                className="h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
                value={to}
                onChange={(e) => { setTo(e.target.value); setDone(false); }}
                placeholder={dialog === "email" ? "customer@email.com" : "+230 5XXX XXXX"}
                inputMode={dialog === "email" ? "email" : "tel"}
                autoFocus
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

function MenuItem({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold text-body hover:bg-sub"
    >
      {icon} {label}
    </button>
  );
}
