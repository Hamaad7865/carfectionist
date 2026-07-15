"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, Download, Share2, ChevronDown, Mail, MessageCircle, Link2, Check } from "lucide-react";
import { publicDocLinkAction } from "./actions";
import { SendDocumentDialog } from "./SendDocumentDialog";

// The "Customise & Share" action set on a document: Print · Download ·
// Email/WhatsApp▾ — the split button opens a menu of Send Email / Send WhatsApp
// / Copy link. Send opens the shared send sheet pre-set to the channel; Copy
// link puts a public, tokenised PDF URL on the clipboard.

export function DocumentShareBar({
  documentId,
  number,
}: {
  documentId: string;
  number: string | null;
  // kept for call-site compatibility; the sheet loads contacts itself
  defaultEmail?: string | null;
  defaultPhone?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "email" | "whatsapp">(null);
  const [copied, setCopied] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  async function copyLink() {
    setMenuOpen(false);
    setLinkErr(null);
    const r = await publicDocLinkAction(documentId);
    if (!r.ok) return setLinkErr(r.error);
    try {
      await navigator.clipboard.writeText(r.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setLinkErr(r.url);
    }
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
            <div role="menu" className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-[12px] border border-line bg-card p-1 shadow-[0_12px_32px_rgba(6,12,20,0.16)]">
              <MenuItem onClick={() => { setMenuOpen(false); setDialog("email"); }} icon={<Mail size={15} className="text-link" />} label="Send Email" />
              <MenuItem onClick={() => { setMenuOpen(false); setDialog("whatsapp"); }} icon={<MessageCircle size={15} className="text-[#25D366]" />} label="Send WhatsApp" />
              <div className="my-1 h-px bg-line-2" />
              <MenuItem onClick={copyLink} icon={<Link2 size={15} className="text-muted" />} label="Copy share link" />
            </div>
          )}
        </div>
      </div>

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

      {dialog && <SendDocumentDialog documentId={documentId} channel={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function MenuItem({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold text-body hover:bg-sub">
      {icon} {label}
    </button>
  );
}
